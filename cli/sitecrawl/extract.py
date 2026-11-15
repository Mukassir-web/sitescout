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
TEXT_LIMIT = 8000
MAX_RECORDS = 400


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

    records = extract_records(tree)

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
        "text_chars": len(text),
        "text_truncated": len(text) > TEXT_LIMIT,
        "word_count": len(text.split()),
        "records": records,
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


NUM_RE = re.compile(r"^[-+]?\$?£?€?\d[\d,]*(\.\d+)?([eE][-+]?\d+)?%?$")


def to_number(v: str):
    v = v.strip().replace(",", "").lstrip("$£€").rstrip("%")
    try:
        return float(v)
    except ValueError:
        return None


def _table_records(tree: HTMLParser) -> list[dict]:
    out = []
    for t in tree.css("table"):
        rows = t.css("tr")
        if len(rows) < 3:
            continue
        head = [_clean(c.text())[:40] for c in rows[0].css("th")] or None
        body_rows = rows[1:] if head else rows
        data = []
        for r in body_rows:
            cells = [_clean(c.text())[:80] for c in r.css("td, th")]
            if cells and any(cells):
                data.append(cells)
        if len(data) >= 2:
            width = max(len(r) for r in data)
            cols = (head or [])[:width] + [f"col{i+1}" for i in range(len(head or []), width)]
            out.append({"kind": "table", "columns": cols, "rows": data[:MAX_RECORDS], "total": len(data)})
    return out


def _fields(it) -> dict[str, str]:
    rec: dict[str, str] = {}
    for n in it.css("[class]"):
        if n.mem_id == it.mem_id:
            continue
        cls = (n.attributes.get("class") or "").split()
        val = _clean(n.text())[:100]
        if not cls or not val or any(_clean(d.text()) for d in n.css("[class]") if d.mem_id != n.mem_id):
            continue
        rec.setdefault(cls[-1] if cls[0].startswith(("col-", "fa", "flag")) else cls[0], val)
    h = it.css_first("h1, h2, h3, h4, h5, [itemprop=name]")
    if h is not None:
        a = h.css_first("a[title]")
        name = _clean(a.attributes.get("title") if a is not None else h.text())[:120]
        if name and name not in rec.values():
            rec = {"name": name, **rec}
    return rec


def _card_records(tree: HTMLParser) -> list[dict]:
    """Repeated blocks sharing a tag+class across the page (product cards, country cards, quote boxes)."""
    body = tree.body
    if body is None:
        return []
    groups: dict[tuple, list] = {}
    for n in body.css("[class]"):
        if n.tag in ("a", "span", "i", "img", "svg", "path", "option", "td", "tr", "th", "li") and n.tag != "li":
            continue
        groups.setdefault((n.tag, n.attributes.get("class")), []).append(n)
    out = []
    for (tag, cls), items in groups.items():
        if len(items) < 5:
            continue
        sample = [_fields(it) for it in items[:5]]
        if sum(len(r) >= 2 for r in sample) < 4:
            continue
        rows, fields = [], []
        for it in items[:MAX_RECORDS]:
            rec = _fields(it)
            for k in rec:
                if k not in fields:
                    fields.append(k)
            rows.append(rec)
        fields = fields[:8]
        out.append({"kind": "list", "selector": f"{tag}.{cls.split()[-1]}", "columns": fields,
                    "rows": [[r.get(f, "") for f in fields] for r in rows], "total": len(items), "_n": len(fields)})
    # prefer the outermost card: drop groups whose columns are a subset of a bigger-or-equal group
    out.sort(key=lambda r: (-r["total"], -r["_n"]))
    keep: list[dict] = []
    for r in out:
        if any(set(r["columns"]) <= set(k["columns"]) for k in keep):
            continue
        keep.append(r)
    for r in keep:
        r.pop("_n", None)
    return keep[:3]


def extract_records(tree: HTMLParser) -> list[dict]:
    recs = _table_records(tree) + _card_records(tree)
    for r in recs:
        stats = {}
        for i, c in enumerate(r["columns"]):
            nums = [(to_number(row[i]), row) for row in r["rows"] if i < len(row) and NUM_RE.match(row[i].strip() or "x")]
            nums = [(v, row) for v, row in nums if v is not None]
            if len(nums) >= max(3, len(r["rows"]) // 2):
                lo, hi = min(nums, key=lambda x: x[0]), max(nums, key=lambda x: x[0])
                stats[c] = {"max": hi[0], "max_row": hi[1][0], "min": lo[0], "min_row": lo[1][0], "count": len(nums)}
                if i == 0 and len(r["columns"]) > 1:
                    stats[c].update(max_row=hi[1][1] if len(hi[1]) > 1 else "", min_row=lo[1][1] if len(lo[1]) > 1 else "")
        r["numeric_stats"] = stats
    return recs[:4]
