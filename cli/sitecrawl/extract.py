"""HTML -> structured page record. Pure functions, no network."""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlsplit, urlunsplit

from selectolax.lexbor import LexborHTMLParser as HTMLParser

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b")
PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
SOCIAL_HOSTS = {
    "twitter.com": "x", "x.com": "x", "facebook.com": "facebook", "instagram.com": "instagram",
    "linkedin.com": "linkedin", "youtube.com": "youtube", "github.com": "github",
    "tiktok.com": "tiktok", "discord.gg": "discord", "discord.com": "discord", "t.me": "telegram",
    "medium.com": "medium", "threads.net": "threads", "mastodon.social": "mastodon",
}
NOISE_TAGS = ["script", "style", "noscript", "svg", "template", "iframe", "form", "nav", "footer", "header", "aside"]
SKIP_EXT = re.compile(r"\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tar|mp4|mp3|wav|avi|mov|css|js|json|xml|woff2?|ttf|eot|exe|dmg|apk)$", re.I)
TEXT_LIMIT = 6000


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def canonical(url: str) -> str:
    p = urlsplit(url)
    path = re.sub(r"/{2,}", "/", p.path or "/")
    path = re.sub(r"/index\.(html?|php)$", "/", path)
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    return urlunsplit((p.scheme.lower(), p.netloc.lower(), path, p.query, ""))


def _meta(tree: HTMLParser, *names: str) -> str:
    for n in names:
        node = tree.css_first(f'meta[name="{n}"]') or tree.css_first(f'meta[property="{n}"]')
        if node and node.attributes.get("content"):
            return _clean(node.attributes["content"])
    return ""


def extract(html: str, url: str) -> dict:
    tree = HTMLParser(html)
    title = _clean(tree.css_first("title").text()) if tree.css_first("title") else ""
    description = _meta(tree, "description", "og:description", "twitter:description")
    site_name = _meta(tree, "og:site_name", "application-name")
    lang = (tree.css_first("html").attributes.get("lang") if tree.css_first("html") else "") or ""

    headings = []
    for node in tree.css("h1, h2, h3"):
        t = _clean(node.text())
        if t and t not in (h["text"] for h in headings):
            headings.append({"level": int(node.tag[1]), "text": t[:200]})
        if len(headings) >= 25:
            break

    # the content region (main/article) is where the page's own links live; header/nav/footer
    # links are site chrome and are ranked lower by the crawler
    articles = tree.css("article")
    body = tree.css_first("main") or (articles[0] if len(articles) == 1 else None) or tree.body
    content_ids: set[int] = set()
    if body is not None and body is not tree.body:
        for a in body.css("a[href]"):
            content_ids.add(hash((a.attributes.get("href"), _clean(a.text())[:80])))

    links: dict[str, dict] = {}
    emails, phones, social = set(), set(), {}
    for a in tree.css("a[href]"):
        href = (a.attributes.get("href") or "").strip()
        if not href or href.startswith("#") or href.lower().startswith("javascript:"):
            continue
        if href.lower().startswith("mailto:"):
            addr = href[7:].split("?")[0].strip()
            if EMAIL_RE.fullmatch(addr):
                emails.add(addr.lower())
            continue
        if href.lower().startswith("tel:"):
            phones.add(_clean(href[4:]))
            continue
        absu = urljoin(url, href)
        p = urlsplit(absu)
        if p.scheme not in ("http", "https"):
            continue
        host = (p.hostname or "").removeprefix("www.")
        for sh, name in SOCIAL_HOSTS.items():
            if host == sh or host.endswith("." + sh):
                social.setdefault(name, absu.split("#")[0])
        clean = urlunsplit((p.scheme, p.netloc, p.path or "/", p.query, ""))
        text = _clean(a.text())[:80] or _clean(a.attributes.get("aria-label") or a.attributes.get("title"))[:80]
        in_content = hash((a.attributes.get("href"), _clean(a.text())[:80])) in content_ids or body is tree.body
        key = canonical(clean)
        prev = links.get(key)
        if prev is None:
            links[key] = {"url": clean, "text": text, "in_content": in_content}
        else:
            prev["in_content"] = prev["in_content"] or in_content
            if not prev["text"] and text:
                prev["text"] = text

    # main text
    text = ""
    if body is not None:
        for tag in NOISE_TAGS:
            for n in body.css(tag):
                n.decompose()
        text = _clean(body.text(separator=" "))
    for m in EMAIL_RE.findall(text):
        if not m.lower().endswith((".png", ".jpg", ".webp")):
            emails.add(m.lower())

    return {
        "url": url,
        "title": title[:300],
        "description": description[:500],
        "site_name": site_name,
        "lang": lang[:10],
        "headings": headings,
        "text_excerpt": text[:TEXT_LIMIT],
        "word_count": len(text.split()),
        "links": list(links.values()),
        "emails": sorted(emails)[:20],
        "phones": sorted(phones)[:10],
        "social": social,
    }


CHROME_PATH = re.compile(r"/(login|log-in|signin|sign-in|signup|sign-up|join|logout|register|cart|checkout|account|password_reset|session)(/|$)", re.I)


def is_crawlable_link(url: str) -> bool:
    p = urlsplit(url)
    if SKIP_EXT.search(p.path) or CHROME_PATH.search(p.path):
        return False
    return "return_to=" not in p.query and "redirect" not in p.query.lower()
