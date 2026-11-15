"""GitHub repositories through GitHub's official REST API instead of scraping HTML.

github.com rate-limits HTML requests from shared cloud IPs (HTTP 429). The public REST API is the
sanctioned way to read the same public data. An optional read-only token (SITESCOUT_GITHUB_TOKEN)
raises the limit from 60 to 5,000 requests an hour; it is only ever sent to api.github.com.
Each API response becomes a normal page record, so the rest of the pipeline is unchanged.
"""
from __future__ import annotations

import asyncio
import os
import re
import time
from urllib.parse import urlsplit

import httpx

from . import events

API = "https://api.github.com"
REPO_PATH = re.compile(r"^/([A-Za-z0-9-]{1,39})/([A-Za-z0-9._-]{1,100})(?:/(.*))?$")
RESERVED = {"features", "about", "pricing", "topics", "orgs", "settings", "marketplace", "explore",
            "login", "signup", "sponsors", "collections", "trending", "enterprise", "security", "site"}


def repo_of(url: str) -> tuple[str, str, str] | None:
    p = urlsplit(url)
    if (p.hostname or "").removeprefix("www.") != "github.com":
        return None
    m = REPO_PATH.match(p.path.rstrip("/"))
    if not m or m.group(1).lower() in RESERVED:
        return None
    return m.group(1), m.group(2).removesuffix(".git"), (m.group(3) or "")


class GitHubUnavailable(Exception):
    pass


def _page(url: str, title: str, description: str, text: str, records: list | None = None) -> dict:
    return {"url": url, "title": title, "description": description[:500], "site_name": "GitHub", "lang": "en",
            "headings": [], "text_excerpt": text[:8000], "text_chars": len(text), "text_truncated": len(text) > 8000,
            "word_count": len(text.split()), "records": records or [], "links": [], "emails": [], "phones": [],
            "social": {}, "source": "GitHub REST API"}


async def _get(client: httpx.AsyncClient, path: str, **params) -> httpx.Response:
    r = await client.get(API + path, params=params or None)
    if r.status_code in (403, 429) and ("rate limit" in r.text.lower() or r.headers.get("x-ratelimit-remaining") == "0"):
        raise GitHubUnavailable("GitHub API rate limit reached for this server")
    if r.status_code == 404:
        raise GitHubUnavailable("repository not found or private")
    if r.status_code >= 400:
        raise GitHubUnavailable(f"GitHub API HTTP {r.status_code}")
    return r


def _last_page(link: str | None) -> int | None:
    m = re.search(r'[?&]page=(\d+)>; rel="last"', link or "")
    return int(m.group(1)) if m else None


async def fetch_repo(owner: str, repo: str, rest: str, user_agent: str, timeout: float) -> list[dict]:
    headers = {"User-Agent": user_agent, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    token = os.environ.get("SITESCOUT_GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    base = f"https://github.com/{owner}/{repo}"
    async with httpx.AsyncClient(headers=headers, timeout=timeout, follow_redirects=False) as client:
        t0 = time.perf_counter()
        events.emit("info", "fetch_start", url=base, depth=0, parent=None)
        info = (await _get(client, f"/repos/{owner}/{repo}")).json()
        branch = info.get("default_branch") or "main"
        readme_r, count_r, list_r, langs_r = await asyncio.gather(
            client.get(f"{API}/repos/{owner}/{repo}/readme", headers={"Accept": "application/vnd.github.raw+json"}),
            _get(client, f"/repos/{owner}/{repo}/commits", per_page=1, sha=branch),
            _get(client, f"/repos/{owner}/{repo}/commits", per_page=30, sha=branch),
            _get(client, f"/repos/{owner}/{repo}/languages"),
        )
        commits = list_r.json()
        total = _last_page(count_r.headers.get("link")) or len(count_r.json())
        langs = langs_r.json() or {}
        readme = readme_r.text if readme_r.status_code == 200 else ""
        ms = int((time.perf_counter() - t0) * 1000)

        overview = (
            f"Repository {info.get('full_name')}. Description: {info.get('description') or 'none'}. "
            f"Stars: {info.get('stargazers_count')}. Forks: {info.get('forks_count')}. Watchers: {info.get('subscribers_count')}. "
            f"Open issues: {info.get('open_issues_count')}. Default branch: {branch}. Total commits on {branch}: {total}. "
            f"Primary language: {info.get('language')}. Languages: {', '.join(langs) or 'n/a'}. "
            f"License: {(info.get('license') or {}).get('name') or 'none'}. Topics: {', '.join(info.get('topics') or []) or 'none'}. "
            f"Created: {info.get('created_at')}. Last push: {info.get('pushed_at')}. Homepage: {info.get('homepage') or 'none'}.\n"
            f"README:\n{readme}"
        )
        p1 = _page(base, f"{info.get('full_name')} on GitHub", info.get("description") or "", overview)
        p1["headings"] = [{"level": 2, "text": h.strip("# ").strip()[:120]} for h in re.findall(r"^#{1,3} .+$", readme, re.M)[:20]]
        p1.update(depth=0, status=200, fetch_ms=ms, relevance=99.0, found_on=None)
        events.emit("info", "page_done", url=base, requested=base, depth=0, status=200, title=p1["title"],
                    words=p1["word_count"], ms=ms, count=1, parent=None, relevance=99.0,
                    preview={"description": p1["description"][:200], "headings": [h["text"] for h in p1["headings"][:5]],
                             "lead": overview[:320], "records": [], "links": 0, "chars": len(overview),
                             "truncated": p1["text_truncated"], "source": "GitHub REST API"})

        curl = f"{base}/commits/{branch}"
        events.emit("info", "fetch_start", url=curl, depth=1, parent=base)
        rows = []
        for c in commits:
            cm = c.get("commit") or {}
            rows.append([(c.get("sha") or "")[:7], (cm.get("message") or "").split("\n")[0][:100],
                         ((c.get("author") or {}).get("login") or (cm.get("author") or {}).get("name") or ""),
                         ((cm.get("author") or {}).get("date") or "")[:10]])
        rec = {"kind": "list", "selector": "commits", "columns": ["sha", "message", "author", "date"],
               "rows": rows, "total": total, "numeric_stats": {}}
        text = f"{total} commits on branch {branch}. Showing the latest {len(rows)}, newest first:\n" + \
               "\n".join(f"{r[0]} {r[3]} {r[2]}: {r[1]}" for r in rows)
        p2 = _page(curl, f"Commits on {branch} \u00b7 {owner}/{repo}", f"{total} commits on {branch}", text, [rec])
        p2.update(depth=1, status=200, fetch_ms=ms, relevance=50.0, found_on=base)
        events.emit("info", "page_done", url=curl, requested=curl, depth=1, status=200, title=p2["title"],
                    words=p2["word_count"], ms=ms, count=2, parent=base, relevance=50.0,
                    preview={"description": p2["description"], "headings": [], "lead": text[:320],
                             "records": [{"what": "commits", "count": total, "columns": rec["columns"]}],
                             "links": 0, "chars": len(text), "truncated": False, "source": "GitHub REST API"})
        return [p1, p2]
