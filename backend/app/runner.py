"""Run orchestration: intent -> approved CLI subprocess -> capture -> validate -> respond.

Every run publishes an ordered list of events that the UI streams over SSE:
  stage    pipeline step changes (interpreting, executing, processing, done)
  intent   the validated TaskSpec
  command  the exact argv launched (no shell) and the pid
  log      one structured line from the CLI's stderr
  result   the final chat payload (summary + JSON + execution record)
  error    an honest failure description
"""
from __future__ import annotations

import asyncio
import json
import re
import os
import signal
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .config import settings
from .intent import interpret
from .llm import injection_score
from .schemas import TaskSpec
from .security import redact
from .summarize import build_output, make_insights, scan_injection

# ---------------------------------------------------------------- tool registry
# The ONLY executables the backend may launch. argv is built from validated fields.
APPROVED_TOOLS = {
    "sitecrawl": {
        "argv": [settings.python_bin, "-m", "sitecrawl", "crawl"],
        "cwd": str(settings.cli_dir),
        "why": "Purpose-built crawler: robots-aware, SSRF-guarded, bounded, emits JSON on stdout.",
    }
}

EXIT_MEANINGS = {
    0: ("succeeded", "Crawl completed."),
    2: ("partial", "Crawl finished with some pages failing or the time budget running out."),
    3: ("failed", "The website could not be reached, or it refused the request."),
    4: ("failed", "The site's robots.txt does not allow crawling this URL."),
    5: ("failed", "The URL was rejected as invalid or unsafe."),
    124: ("timed_out", "The crawl hit its time limit before any page was fetched."),
    130: ("cancelled", "The run was cancelled."),
}

_sem = asyncio.Semaphore(settings.max_concurrent_runs)
RUNS: dict[str, "Run"] = {}
MAX_RUNS_KEPT = 200


@dataclass
class Run:
    id: str
    prompt: str
    history: list = field(default_factory=list)
    created: float = field(default_factory=time.time)
    state: str = "queued"  # queued|interpreting|executing|processing|succeeded|partial|failed|timed_out|cancelled|rejected
    events: list[dict] = field(default_factory=list)
    cond: asyncio.Condition = field(default_factory=asyncio.Condition)
    proc: asyncio.subprocess.Process | None = None
    task: asyncio.Task | None = None
    cancel_requested: bool = False
    final: dict | None = None

    @property
    def done(self) -> bool:
        return self.state in {"succeeded", "partial", "failed", "timed_out", "cancelled", "rejected"}

    async def emit(self, kind: str, data: Any) -> None:
        if isinstance(data, str):
            data = redact(data)
        evt = {"seq": len(self.events), "kind": kind, "t": round(time.time() - self.created, 3), "data": data}
        async with self.cond:
            self.events.append(evt)
            self.cond.notify_all()

    async def stage(self, state: str, label: str) -> None:
        self.state = state
        await self.emit("stage", {"state": state, "label": label})


def build_argv(task: TaskSpec) -> list[str]:
    tool = APPROVED_TOOLS["sitecrawl"]
    argv = [*tool["argv"], "--url", task.url, "--max-pages", str(task.max_pages), "--depth", str(task.depth),
            "--timeout", str(settings.crawl_timeout_s), "--quiet-debug"]
    focus = re.sub(r"[^\w\s.,'-]", " ", task.focus or "")
    focus = re.sub(r"\s+", " ", focus).strip()[:160]
    if focus:
        argv += ["--focus", focus]
    return argv


def display_argv(argv: list[str]) -> str:
    shown = ["sitecrawl", *argv[4:]] if argv[:3] == APPROVED_TOOLS["sitecrawl"]["argv"][:3] else argv
    return " ".join(json.dumps(a) if (" " in a or not a) else a for a in shown)


def _child_env() -> dict:
    """Minimal environment: the CLI gets no API keys or secrets."""
    keep = {k: os.environ[k] for k in ("PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR", "HOME") if k in os.environ}
    keep["PYTHONUNBUFFERED"] = "1"
    keep["PYTHONPATH"] = str(settings.cli_dir)
    # optional public-read token, used by the CLI only for api.github.com (see cli/sitecrawl/github.py)
    gh = os.environ.get("SITESCOUT_GITHUB_TOKEN", "").strip()
    if gh:
        keep["SITESCOUT_GITHUB_TOKEN"] = gh
    return keep


async def _kill(proc: asyncio.subprocess.Process, grace: float = 3.0) -> None:
    if proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)  # lets the CLI flush partial results
    except ProcessLookupError:
        return
    try:
        await asyncio.wait_for(proc.wait(), grace)
    except asyncio.TimeoutError:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


async def execute_cli(run: Run, task: TaskSpec) -> dict:
    """Start the approved CLI, stream stderr as events, collect stdout, enforce wall timeout."""
    argv = build_argv(task)
    wall_timeout = settings.crawl_timeout_s + settings.process_grace_s
    workdir = tempfile.mkdtemp(prefix="sitescout-")
    t0 = time.perf_counter()
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=APPROVED_TOOLS["sitecrawl"]["cwd"],
        env=_child_env(),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,  # own process group so we can kill the whole tree
        limit=1 << 20,
    )
    run.proc = proc
    await run.emit("command", {"tool": "sitecrawl", "argv": display_argv(argv), "pid": proc.pid,
                               "timeout_s": wall_timeout, "why": APPROVED_TOOLS["sitecrawl"]["why"]})

    stderr_tail: list[str] = []
    stdout_chunks: list[bytes] = []
    stdout_size = 0

    async def pump_stderr():
        assert proc.stderr
        async for raw in proc.stderr:
            line = raw.decode("utf-8", "replace").rstrip()
            if not line:
                continue
            stderr_tail.append(line)
            del stderr_tail[:-40]
            try:
                evt = json.loads(line)
            except ValueError:
                evt = {"level": "raw", "event": "stderr", "message": line[:500]}
            await run.emit("log", evt)

    async def pump_stdout():
        nonlocal stdout_size
        assert proc.stdout
        while chunk := await proc.stdout.read(65536):
            stdout_size += len(chunk)
            if stdout_size > settings.max_stdout_bytes:
                await run.emit("log", {"level": "error", "event": "stdout_overflow", "limit": settings.max_stdout_bytes})
                await _kill(proc)
                break
            stdout_chunks.append(chunk)

    timed_out = False
    try:
        await asyncio.wait_for(asyncio.gather(pump_stderr(), pump_stdout(), proc.wait()), wall_timeout)
    except asyncio.TimeoutError:
        timed_out = True
        await run.emit("log", {"level": "error", "event": "wall_timeout", "seconds": wall_timeout})
        await _kill(proc)
    except asyncio.CancelledError:
        await _kill(proc)
        raise
    finally:
        try:
            os.rmdir(workdir)
        except OSError:
            pass

    return {
        "exit_code": proc.returncode,
        "stdout": b"".join(stdout_chunks).decode("utf-8", "replace"),
        "stderr_tail": [redact(l) for l in stderr_tail[-12:]],
        "duration_ms": int((time.perf_counter() - t0) * 1000),
        "timed_out": timed_out,
        "argv": display_argv(argv),
        "pid": proc.pid,
    }


def validate_and_parse(stdout: str) -> dict | None:
    try:
        data = json.loads(stdout)
    except ValueError:
        return None
    if not isinstance(data, dict) or data.get("schema") != "sitecrawl.result/v1":
        return None
    if not isinstance(data.get("pages"), list) or not isinstance(data.get("stats"), dict):
        return None
    return data


async def pipeline(run: Run) -> None:
    async with _sem:
        try:
            await _pipeline(run)
        except asyncio.CancelledError:
            run.state = "cancelled"
            run.final = {"state": "cancelled", "message": "Run cancelled before completion."}
            await run.emit("result", run.final)
        except Exception as exc:  # never leak internals
            run.state = "failed"
            run.final = {"state": "failed", "message": f"Internal error ({type(exc).__name__}). Nothing was fabricated; please retry."}
            await run.emit("error", run.final)
        finally:
            await run.emit("end", {"state": run.state})


async def _pipeline(run: Run) -> None:
    # 1. Interpret ---------------------------------------------------------------
    await run.stage("interpreting", "Understanding your request")
    guard_task = asyncio.create_task(injection_score(run.prompt))
    task, warn = await interpret(run.prompt, run.history)
    score = await guard_task
    if score is not None and score >= 0.9 and task.action == "crawl_site":
        run.state = "rejected"
        run.final = {"state": "rejected", "message": "That request looks like a prompt-injection attempt, so I didn't run anything. Ask me to crawl a public website instead.",
                     "guard_score": round(score, 3)}
        await run.emit("intent", {"task": task.model_dump(), "warning": warn, "guard_score": round(score, 3)})
        await run.emit("result", run.final)
        return
    await run.emit("intent", {"task": task.model_dump(), "warning": warn, "guard_score": None if score is None else round(score, 3)})

    if task.action != "crawl_site":
        run.state = "rejected"
        msg = task.reply or ("I can crawl a public website for you. Try: \u201cCrawl example.com and give me a summary and JSON\u201d."
                             if task.action == "unsupported" else "Which website should I crawl?")
        run.final = {"state": "clarify" if task.action == "clarify" else "unsupported", "message": msg}
        await run.emit("result", run.final)
        return

    # 2. Execute -----------------------------------------------------------------
    await run.stage("executing", "Running sitecrawl")
    cap = await execute_cli(run, task)
    if run.cancel_requested:
        cap["exit_code"] = 130

    # 3. Process -----------------------------------------------------------------
    await run.stage("processing", "Validating output")
    parsed = validate_and_parse(cap["stdout"])
    code = cap["exit_code"]
    state, meaning = EXIT_MEANINGS.get(code, ("failed", f"The CLI exited unexpectedly (code {code})."))
    if cap["timed_out"]:
        state, meaning = "timed_out", "The process exceeded its wall-clock limit and was killed."
    if parsed is None:
        state = "failed" if state in ("succeeded", "partial") else state
        meaning = meaning if code != 0 else "The CLI exited 0 but produced invalid output, so the result was discarded."

    execution = {
        "tool": "sitecrawl",
        "command": cap["argv"],
        "pid": cap["pid"],
        "exit_code": code,
        "status": state,
        "duration_ms": cap["duration_ms"],
        "output_valid": parsed is not None,
        "intent_parsed_by": task.interpreted_by,
    }

    insights, summary_source, flags = None, "none", []
    if parsed and parsed.get("pages"):
        await run.stage("processing", "Summarising extracted content")
        (insights, summary_source), flags = await asyncio.gather(make_insights(parsed, task), scan_injection(parsed))

    data = build_output(parsed, insights, summary_source, task, execution, flags) if parsed else None
    run.state = state
    run.final = {
        "state": state,
        "message": meaning,
        "error": redact(parsed.get("error")) if parsed and parsed.get("error") else None,
        "outputs": task.outputs,
        "summary": insights.model_dump() if insights else None,
        "summary_source": summary_source,
        "data": data,
        "execution": execution | {"stderr_tail": cap["stderr_tail"]},
        "warning": warn,
    }
    await run.emit("result", run.final)


def new_run(prompt: str, history=None) -> Run:
    if len(RUNS) >= MAX_RUNS_KEPT:
        for rid in sorted(RUNS, key=lambda r: RUNS[r].created)[: len(RUNS) - MAX_RUNS_KEPT + 1]:
            if RUNS[rid].done:
                RUNS.pop(rid, None)
    run = Run(id=uuid.uuid4().hex[:12], prompt=prompt, history=list(history or []))
    RUNS[run.id] = run
    run.task = asyncio.create_task(pipeline(run))
    return run


async def cancel_run(run: Run) -> None:
    run.cancel_requested = True
    if run.proc and run.proc.returncode is None:
        await run.emit("log", {"level": "warn", "event": "cancel_requested"})
        await _kill(run.proc)
    elif run.task and not run.task.done() and run.state in ("queued", "interpreting"):
        run.task.cancel()
