"""Polite, bounded, same-site BFS crawler."""
from __future__ import annotations

import asyncio
import time
import urllib.robotparser
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import httpx

from . import events
from .extract import canonical, extract, is_crawlable_link
from .netguard import UnresolvableHostError, UnsafeURLError, check_url

USER_AGENT = "SiteScoutBot/1.0 (+educational crawler; respects robots.txt)"
MAX_REDIRECTS = 5


@dataclass
class Limits:
    max_pages: int = 10
    max_depth: int = 2
    timeout: float = 45.0           # whole crawl budget (seconds)
    request_timeout: float = 10.0   # per request
    max_bytes: int = 2_000_000      # per page
    concurrency: int = 4
    respect_robots: bool = True


@dataclass
class CrawlState:
    pages: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    skipped: list = field(default_factory=list)
    bytes: int = 0
    robots: str = "not_checked"
    start_final_url: str | None = None


class FetchError(Exception):
    def __init__(self, kind: str, msg: str, status: int | None = None):
        super().__init__(msg)
        self.kind, self.status = kind, status


def _same_site(a: str, b: str) -> bool:
    ha = (urlsplit(a).hostname or "").removeprefix("www.")
    hb = (urlsplit(b).hostname or "").removeprefix("www.")
    return ha == hb


async def _guarded(url: str) -> str:
    try:
        return await asyncio.to_thread(check_url, url)
    except UnresolvableHostError as exc:
        raise FetchError("dns", str(exc)) from exc
    except UnsafeURLError as exc:
        raise FetchError("blocked", str(exc)) from exc


async def fetch(client: httpx.AsyncClient, url: str, lim: Limits, html_only: bool = True) -> tuple[str, str, int]:
    """GET with manual, re-validated redirects and a byte cap. Returns (final_url, body, status)."""
    current = await _guarded(url)
    for _ in range(MAX_REDIRECTS + 1):
        try:
            async with client.stream("GET", current, timeout=lim.request_timeout) as r:
                if r.is_redirect:
                    loc = r.headers.get("location")
                    if not loc:
                        raise FetchError("http", "redirect without location", r.status_code)
                    current = await _guarded(urljoin(current, loc))
                    continue
                if r.status_code >= 400:
                    raise FetchError("http", f"HTTP {r.status_code}", r.status_code)
                ctype = r.headers.get("content-type", "").lower()
                if html_only and "html" not in ctype:
                    raise FetchError("content_type", f"not HTML ({ctype or 'unknown'})", r.status_code)
                chunks, size = [], 0
                async for chunk in r.aiter_bytes():
                    size += len(chunk)
                    if size > lim.max_bytes:
                        events.emit("warn", "page_truncated", url=current, limit=lim.max_bytes)
                        break
                    chunks.append(chunk)
                raw = b"".join(chunks)
                enc = r.encoding or "utf-8"
                return current, raw.decode(enc, errors="replace"), r.status_code
        except httpx.TimeoutException as exc:
            raise FetchError("timeout", f"request timed out after {lim.request_timeout:.0f}s") from exc
        except httpx.HTTPError as exc:
            raise FetchError("network", type(exc).__name__ + ": " + str(exc)[:160]) from exc
    raise FetchError("http", "too many redirects")


async def load_robots(client: httpx.AsyncClient, start: str, lim: Limits, st: CrawlState):
    p = urlsplit(start)
    robots_url = f"{p.scheme}://{p.netloc}/robots.txt"
    rp = urllib.robotparser.RobotFileParser()
    try:
        _, body, _ = await fetch(client, robots_url, lim, html_only=False)
        rp.parse(body.splitlines())
        st.robots = "found"
        events.emit("info", "robots_loaded", url=robots_url)
    except FetchError as exc:
        rp.parse([])  # missing robots.txt => everything allowed
        st.robots = "missing" if exc.status in (404, 410) else "unavailable"
        events.emit("info", "robots_unavailable", url=robots_url, reason=str(exc))
    return rp


async def crawl(start_url: str, lim: Limits, st: CrawlState) -> None:
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"}
    async with httpx.AsyncClient(headers=headers, follow_redirects=False, http2=False) as client:
        rp = await load_robots(client, start_url, lim, st) if lim.respect_robots else None
        if rp is not None and not rp.can_fetch(USER_AGENT, start_url):
            st.robots = "disallowed"
            raise FetchError("robots", "robots.txt disallows crawling this URL")

        seen: set[str] = {canonical(start_url)}
        frontier: list[str] = [start_url]
        sem = asyncio.Semaphore(lim.concurrency)

        async def visit(url: str, depth: int) -> list[str]:
            if len(st.pages) >= lim.max_pages:
                return []
            async with sem:
                if len(st.pages) >= lim.max_pages:
                    return []
                t0 = time.perf_counter()
                events.emit("info", "fetch_start", url=url, depth=depth)
                try:
                    final, body, status = await fetch(client, url, lim)
                except FetchError as exc:
                    st.errors.append({"url": url, "kind": exc.kind, "message": str(exc), "status": exc.status})
                    events.emit("warn", "fetch_failed", url=url, kind=exc.kind, message=str(exc))
                    if depth == 0:
                        raise
                    return []
                if depth == 0:
                    st.start_final_url = final
                st.bytes += len(body.encode("utf-8", errors="ignore"))
                page = extract(body, final)
                page.update(depth=depth, status=status, fetch_ms=int((time.perf_counter() - t0) * 1000))
                links = page.pop("links")
                internal = [l for l in links if _same_site(l, start_url) and is_crawlable_link(l)]
                page["internal_links"] = len(internal)
                page["external_links"] = len(links) - len(internal)
                if len(st.pages) < lim.max_pages:
                    st.pages.append(page)
                    events.emit("info", "page_done", url=final, depth=depth, status=status,
                                title=page["title"][:120], words=page["word_count"],
                                ms=page["fetch_ms"], count=len(st.pages), parent=None)
                return internal

        for depth in range(lim.max_depth + 1):
            if not frontier or len(st.pages) >= lim.max_pages:
                break
            results = await asyncio.gather(*(visit(u, depth) for u in frontier))
            nxt: list[str] = []
            for parent, found in zip(frontier, results):
                for link in found:
                    c = canonical(link)
                    if c in seen:
                        continue
                    seen.add(c)
                    if rp is not None and not rp.can_fetch(USER_AGENT, link):
                        st.skipped.append({"url": link, "reason": "robots.txt"})
                        continue
                    nxt.append(link)
                    events.emit("debug", "link_queued", url=link, parent=parent, depth=depth + 1)
            remaining = lim.max_pages - len(st.pages)
            frontier = nxt[: max(remaining, 0) * 2]  # small buffer for failures
