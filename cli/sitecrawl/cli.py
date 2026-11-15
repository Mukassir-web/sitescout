"""Command-line entry point.

    sitecrawl crawl --url https://example.com --max-pages 10 --depth 2 --timeout 45

stdout : one JSON document (the result), or written to --out
stderr : JSON-lines progress events
exit   : 0 ok | 2 partial | 3 unreachable | 4 robots disallowed | 5 invalid input
         | 124 timed out with no pages | 130 cancelled
"""
from __future__ import annotations

import argparse
import asyncio
import json
import signal
import sys
import time

from . import __version__, events
from .crawler import CrawlState, FetchError, Limits, USER_AGENT, crawl
from .netguard import UnresolvableHostError, UnsafeURLError, check_url

EXIT_OK, EXIT_PARTIAL, EXIT_UNREACHABLE, EXIT_ROBOTS, EXIT_INPUT, EXIT_TIMEOUT, EXIT_CANCELLED = 0, 2, 3, 4, 5, 124, 130

HARD_CAPS = {"max_pages": 25, "depth": 3, "timeout": 90}


def _bounded(name: str, lo: int, hi: int):
    def parse(v: str) -> int:
        try:
            n = int(v)
        except ValueError:
            raise argparse.ArgumentTypeError(f"{name} must be an integer")
        if not lo <= n <= hi:
            raise argparse.ArgumentTypeError(f"{name} must be between {lo} and {hi}")
        return n
    return parse


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="sitecrawl", description="Bounded, robots-aware website crawler.")
    p.add_argument("--version", action="version", version=f"sitecrawl {__version__}")
    sub = p.add_subparsers(dest="command", required=True)
    c = sub.add_parser("crawl", help="crawl a site and emit structured JSON")
    c.add_argument("--url", required=True)
    c.add_argument("--max-pages", type=_bounded("max-pages", 1, HARD_CAPS["max_pages"]), default=10)
    c.add_argument("--depth", type=_bounded("depth", 0, HARD_CAPS["depth"]), default=2)
    c.add_argument("--timeout", type=_bounded("timeout", 5, HARD_CAPS["timeout"]), default=45)
    c.add_argument("--concurrency", type=_bounded("concurrency", 1, 6), default=4)
    c.add_argument("--out", help="write result JSON to this file instead of stdout")
    c.add_argument("--quiet-debug", action="store_true", help="suppress debug events")
    return p


def _aggregate(st: CrawlState) -> dict:
    emails, phones, social = set(), set(), {}
    site_name = ""
    for pg in st.pages:
        emails.update(pg.pop("emails", []))
        phones.update(pg.pop("phones", []))
        for k, v in pg.pop("social", {}).items():
            social.setdefault(k, v)
        site_name = site_name or pg.get("site_name", "")
    first = st.pages[0] if st.pages else {}
    return {
        "name": site_name or first.get("title", ""),
        "description": first.get("description", ""),
        "language": first.get("lang", ""),
        "emails": sorted(emails)[:20],
        "phones": sorted(phones)[:10],
        "social_links": social,
    }


async def run(args) -> int:
    lim = Limits(max_pages=args.max_pages, max_depth=args.depth, timeout=args.timeout, concurrency=args.concurrency)
    st = CrawlState()
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    t0 = time.perf_counter()
    status, code, fatal = "success", EXIT_OK, None

    try:
        url = await asyncio.to_thread(check_url, args.url)
    except UnresolvableHostError as exc:
        events.emit("error", "unreachable", message=str(exc))
        url, status, code, fatal = args.url, "unreachable", EXIT_UNREACHABLE, str(exc)
    except UnsafeURLError as exc:
        events.emit("error", "invalid_input", message=str(exc))
        url, status, code, fatal = args.url, "invalid_input", EXIT_INPUT, str(exc)

    if fatal is None:
        events.emit("info", "crawl_start", url=url, max_pages=lim.max_pages, depth=lim.max_depth, timeout=lim.timeout)
        task = asyncio.ensure_future(crawl(url, lim, st))
        loop = asyncio.get_running_loop()
        cancelled = {"flag": False}

        def _on_term():
            cancelled["flag"] = True
            task.cancel()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, _on_term)
            except (NotImplementedError, RuntimeError):
                pass
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=lim.timeout)
        except asyncio.TimeoutError:
            task.cancel()
            events.emit("warn", "crawl_timeout", seconds=lim.timeout, pages=len(st.pages))
            status, code = ("partial", EXIT_PARTIAL) if st.pages else ("timed_out", EXIT_TIMEOUT)
            fatal = f"crawl budget of {lim.timeout}s exhausted"
        except asyncio.CancelledError:
            events.emit("warn", "crawl_cancelled", pages=len(st.pages))
            status, code, fatal = "cancelled", EXIT_CANCELLED, "cancelled by caller"
        except FetchError as exc:
            if exc.kind == "robots":
                status, code = "robots_disallowed", EXIT_ROBOTS
            elif exc.kind == "blocked":
                status, code = "invalid_input", EXIT_INPUT
            else:
                status, code = "unreachable", EXIT_UNREACHABLE
            fatal = str(exc)
            events.emit("error", "crawl_failed", kind=exc.kind, message=str(exc))
        else:
            if st.errors and code == EXIT_OK:
                status, code = "partial", EXIT_PARTIAL
        if cancelled["flag"] and code != EXIT_CANCELLED:
            status, code, fatal = "cancelled", EXIT_CANCELLED, "cancelled by caller"

    duration = int((time.perf_counter() - t0) * 1000)
    site = _aggregate(st)
    result = {
        "schema": "sitecrawl.result/v1",
        "tool": {"name": "sitecrawl", "version": __version__, "user_agent": USER_AGENT},
        "status": status,
        "exit_code": code,
        "error": fatal,
        "start_url": url,
        "final_url": st.start_final_url,
        "started_at": started,
        "limits": {"max_pages": lim.max_pages, "depth": lim.max_depth, "timeout_s": lim.timeout},
        "robots_txt": st.robots,
        "stats": {
            "pages_crawled": len(st.pages),
            "pages_failed": len(st.errors),
            "pages_skipped": len(st.skipped),
            "bytes_downloaded": st.bytes,
            "duration_ms": duration,
        },
        "site": site,
        "pages": st.pages,
        "errors": st.errors,
        "skipped": st.skipped[:50],
    }
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(payload)
    else:
        sys.stdout.write(payload + "\n")
    events.emit("info", "crawl_end", status=status, exit_code=code, pages=len(st.pages), ms=duration)
    return code


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as e:
        return EXIT_INPUT if e.code not in (0, None) else 0
    if args.quiet_debug:
        events.QUIET_LEVELS.add("debug")
    return asyncio.run(run(args))
