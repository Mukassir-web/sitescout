"""Polite, bounded, same-site BFS crawler."""
from __future__ import annotations

import asyncio
import re
import time
import urllib.robotparser
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import httpx

from . import events
from .extract import canonical, extract, is_crawlable_link
from .github import GitHubUnavailable, fetch_repo, repo_of
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
    focus: str = ""                 # words that make a link more relevant
    scope: str = "auto"             # auto: stay under the start URL's path when it has one


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
    retried = False
    for _ in range(MAX_REDIRECTS + 2):
        try:
            async with client.stream("GET", current, timeout=lim.request_timeout) as r:
                if r.is_redirect:
                    loc = r.headers.get("location")
                    if not loc:
                        raise FetchError("http", "redirect without location", r.status_code)
                    current = await _guarded(urljoin(current, loc))
                    continue
                if r.status_code in (429, 503) and not retried:
                    # one polite retry, honouring Retry-After but never waiting long
                    retried = True
                    try:
                        wait = float(r.headers.get("retry-after", "2"))
                    except ValueError:
                        wait = 2.0
                    wait = min(max(wait, 1.0), 4.0)
                    events.emit("warn", "rate_limited", url=current, status=r.status_code, retry_in_s=wait)
                    await asyncio.sleep(wait)
                    continue
                if r.status_code == 429:
                    raise FetchError("rate_limited", "HTTP 429 (the site is rate-limiting requests)", 429)
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


STOP = {"the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "what", "how", "many",
        "does", "do", "it", "this", "that", "me", "my", "about", "with", "tell", "give", "site", "website",
        "page", "pages", "please", "info", "information", "json", "summary", "summarise", "summarize",
        "have", "has", "there", "which", "who", "when", "where", "why", "can", "you", "show", "list", "find",
        "get", "all", "any", "its", "their", "they", "from", "crawl", "extract", "return", "data", "dude", "abt"}


def focus_terms(focus: str) -> list[str]:
    words = re.findall(r"[a-z0-9]{3,}", (focus or "").lower())
    out = []
    for w in words:
        if w in STOP:
            continue
        out.append(w[:-1] if w.endswith("s") and len(w) > 4 else w)  # commits -> commit
    return list(dict.fromkeys(out))[:8]


def scope_prefix(start_url: str) -> str:
    """'/owner/repo' for https://github.com/owner/repo, '/docs' for /docs/intro.html, '' for the root."""
    path = urlsplit(start_url).path or "/"
    if path in ("", "/"):
        return ""
    last = path.rstrip("/").rsplit("/", 1)[-1]
    if "." in last and not path.endswith("/"):
        path = path.rsplit("/", 1)[0]
    return path.rstrip("/")


def score_link(link: dict, prefix: str, terms: list[str]) -> float:
    path = urlsplit(link["url"]).path.lower()
    hay = (path + " " + (link.get("text") or "")).lower()
    s = 0.0
    if prefix and (path == prefix.lower() or path.startswith(prefix.lower() + "/")):
        s += 6
    if link.get("in_content"):
        s += 3
    s += sum(4 for t in terms if t in hay)
    s -= path.count("/") * 0.15 + (0.5 if urlsplit(link["url"]).query else 0)
    return s


async def crawl(start_url: str, lim: Limits, st: CrawlState) -> None:
    gh = repo_of(start_url)
    if gh:
        events.emit("info", "crawl_plan", scope=f"/{gh[0]}/{gh[1]}", focus_terms=focus_terms(lim.focus),
                    source="GitHub REST API")
        try:
            pages = await asyncio.wait_for(fetch_repo(*gh, USER_AGENT, lim.request_timeout), lim.timeout)
            want_commits = "commit" in gh[2].lower() or "commit" in lim.focus.lower()
            if lim.max_pages == 1:
                pages = [pages[1] if want_commits else pages[0]]
            st.pages.extend(pages)
            st.start_final_url = pages[0]["url"]
            st.robots = "not_applicable (official API)"
            for pg in st.pages:
                pg.pop("links", None)
                pg.setdefault("internal_links", 0)
                pg.setdefault("external_links", 0)
            return
        except (GitHubUnavailable, httpx.HTTPError, asyncio.TimeoutError) as exc:
            events.emit("warn", "source_fallback", source="GitHub REST API", message=str(exc) or type(exc).__name__)
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"}
    async with httpx.AsyncClient(headers=headers, follow_redirects=False, http2=False) as client:
        rp = await load_robots(client, start_url, lim, st) if lim.respect_robots else None
        if rp is not None and not rp.can_fetch(USER_AGENT, start_url):
            st.robots = "disallowed"
            raise FetchError("robots", "robots.txt disallows crawling this URL")

        seen: set[str] = {canonical(start_url)}
        frontier: list[str] = [start_url]
        parents: dict[str, str | None] = {start_url: None}
        sem = asyncio.Semaphore(lim.concurrency)
        inflight = [0]
        terms = focus_terms(lim.focus)
        prefix = scope_prefix(start_url) if lim.scope == "auto" else ""
        scores: dict[str, float] = {start_url: 99.0}
        events.emit("info", "crawl_plan", scope=prefix or "/", focus_terms=terms)

        async def visit(url: str, depth: int) -> list[dict]:
            if len(st.pages) >= lim.max_pages:
                return []
            async with sem:
                if len(st.pages) + inflight[0] >= lim.max_pages:
                    return []
                inflight[0] += 1
                t0 = time.perf_counter()
                events.emit("info", "fetch_start", url=url, depth=depth, parent=parents.get(url))
                try:
                    final, body, status = await fetch(client, url, lim)
                except FetchError as exc:
                    inflight[0] -= 1
                    st.errors.append({"url": url, "kind": exc.kind, "message": str(exc), "status": exc.status})
                    events.emit("warn", "fetch_failed", url=url, kind=exc.kind, message=str(exc))
                    if depth == 0:
                        raise
                    return []
                inflight[0] -= 1
                if depth == 0:
                    st.start_final_url = final
                st.bytes += len(body.encode("utf-8", errors="ignore"))
                page = extract(body, final)
                page.update(depth=depth, status=status, fetch_ms=int((time.perf_counter() - t0) * 1000),
                            relevance=round(scores.get(url, 0.0), 2), found_on=parents.get(url))
                links = page.pop("links")
                internal = [l for l in links if _same_site(l["url"], start_url) and is_crawlable_link(l["url"])]
                for l in internal:
                    l["score"] = score_link(l, prefix, terms)
                if prefix and any(l["score"] >= 6 for l in internal):
                    # the user pointed at a section (a repo, a docs folder): stay inside it
                    internal = [l for l in internal if l["score"] >= 6]
                page["internal_links"] = len(internal)
                page["external_links"] = len(links) - len(internal)
                if len(st.pages) >= lim.max_pages:
                    events.emit("info", "page_discarded", url=url, reason="page limit reached")
                    return []
                st.pages.append(page)
                events.emit("info", "page_done", url=final, requested=url, depth=depth, status=status,
                            title=page["title"][:120], words=page["word_count"],
                            ms=page["fetch_ms"], count=len(st.pages), parent=parents.get(url),
                            relevance=round(scores.get(url, 0.0), 2),
                            preview={
                                "description": page["description"][:200],
                                "headings": [h["text"][:90] for h in page["headings"][:5]],
                                "lead": page["text_excerpt"][:320],
                                "records": [{"what": r.get("selector") or "table", "count": r["total"],
                                             "columns": r["columns"][:5]} for r in page.get("records", [])][:3],
                                "links": len(links), "chars": page.get("text_chars", 0),
                                "truncated": page.get("text_truncated", False),
                            })
                return internal

        for depth in range(lim.max_depth + 1):
            if not frontier or len(st.pages) >= lim.max_pages:
                break
            results = await asyncio.gather(*(visit(u, depth) for u in frontier))
            cand: list[tuple[float, str, str]] = []
            for parent, found in zip(frontier, results):
                for item in found:
                    cand.append((item["score"], item["url"], parent))
            cand.sort(key=lambda x: -x[0])
            nxt: list[str] = []
            for sc, link, parent in cand:
                c = canonical(link)
                if c in seen:
                    continue
                seen.add(c)
                if rp is not None and not rp.can_fetch(USER_AGENT, link):
                    st.skipped.append({"url": link, "reason": "robots.txt"})
                    continue
                nxt.append(link)
                parents[link] = parent
                scores[link] = sc
                events.emit("debug", "link_queued", url=link, parent=parent, depth=depth + 1)
            remaining = lim.max_pages - len(st.pages)
            frontier = nxt[: max(remaining, 0) * 2]  # small buffer for failures
