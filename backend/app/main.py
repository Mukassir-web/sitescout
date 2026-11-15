"""FastAPI app: chat API, live execution stream (SSE), static frontend."""
from __future__ import annotations

import asyncio
import json
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from sse_starlette.sse import EventSourceResponse

from . import runner
from .config import settings
from .schemas import ChatRequest
from .security import SECURITY_HEADERS, RateLimiter

app = FastAPI(title="SiteScout", version="1.0.0", docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")
limiter = RateLimiter(settings.rate_limit_per_min)

if settings.allowed_origins:
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins),
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@app.middleware("http")
async def headers_mw(request: Request, call_next):
    resp = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        resp.headers.setdefault(k, v)
    return resp


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


@app.get("/api/health")
async def health():
    return {"ok": True, "llm": settings.llm_enabled, "tools": list(runner.APPROVED_TOOLS),
            "models": {"intent": settings.intent_model, "summary": settings.summary_model, "guard": settings.guard_model},
            "limits": {"max_pages": settings.max_pages_cap, "max_depth": settings.max_depth_cap,
                       "crawl_timeout_s": settings.crawl_timeout_s, "rate_limit_per_min": settings.rate_limit_per_min}}


@app.post("/api/runs", status_code=202)
async def create_run(request: Request):
    ok, retry = limiter.allow(client_ip(request))
    if not ok:
        raise HTTPException(429, f"Too many requests. Try again in {retry}s.", headers={"Retry-After": str(retry)})
    try:
        body = ChatRequest.model_validate(await request.json())
    except (ValidationError, ValueError):
        raise HTTPException(422, f"Send a JSON body like {{\"prompt\": \"...\"}} (max {settings.max_prompt_chars} chars).")
    run = runner.new_run(body.prompt, body.history)
    return {"id": run.id, "state": run.state}


def _get(run_id: str) -> runner.Run:
    run = runner.RUNS.get(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    run = _get(run_id)
    return {"id": run.id, "state": run.state, "prompt": run.prompt, "final": run.final}


@app.post("/api/runs/{run_id}/cancel")
async def cancel(run_id: str):
    run = _get(run_id)
    if run.done:
        return {"id": run.id, "state": run.state, "cancelled": False}
    await runner.cancel_run(run)
    return {"id": run.id, "state": run.state, "cancelled": True}


@app.get("/api/runs/{run_id}/events")
async def events(run_id: str, request: Request):
    run = _get(run_id)
    start = int(request.headers.get("last-event-id", "-1")) + 1

    async def gen():
        i = start
        last_ping = time.monotonic()
        while True:
            if await request.is_disconnected():
                return
            async with run.cond:
                if i >= len(run.events) and not run.done:
                    try:
                        await asyncio.wait_for(run.cond.wait(), 15)
                    except asyncio.TimeoutError:
                        pass
                batch = run.events[i:]
            for evt in batch:
                yield {"id": str(evt["seq"]), "event": evt["kind"], "data": json.dumps(evt, ensure_ascii=False)}
                i += 1
                if evt["kind"] == "end":
                    return
            if run.done and i >= len(run.events):
                return
            if time.monotonic() - last_ping > 15:
                last_ping = time.monotonic()

    return EventSourceResponse(gen(), ping=15, headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.exception_handler(HTTPException)
async def http_exc(_: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


# ---- static frontend (built React app) ----------------------------------------
if settings.static_dir.exists():
    class ImmutableStatic(StaticFiles):
        async def get_response(self, path, scope):
            resp = await super().get_response(path, scope)
            if resp.status_code == 200:
                resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp

    app.mount("/assets", ImmutableStatic(directory=settings.static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        target = (settings.static_dir / path).resolve()
        if path and target.is_file() and settings.static_dir.resolve() in target.parents:
            return FileResponse(target)
        # index.html must never be cached, so a new deploy shows up on the next refresh;
        # hashed files under /assets are immutable and can be cached forever
        return FileResponse(settings.static_dir / "index.html", headers={"Cache-Control": "no-cache, must-revalidate"})
