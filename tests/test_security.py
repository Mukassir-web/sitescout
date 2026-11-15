"""Fast, offline tests for the safety-critical pieces. Run: pytest -q"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "cli"), str(ROOT / "backend")]

from sitecrawl.netguard import UnsafeURLError, check_url, normalize_url  # noqa: E402
from sitecrawl.extract import canonical, extract  # noqa: E402


@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "ftp://example.com", "http://localhost/", "http://127.0.0.1/",
    "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data",
    "http://[::1]/", "http://user:pass@example.com/", "http://example.com:22/",
    "http://0.0.0.0/", "http://metadata.internal/",
])
def test_unsafe_urls_rejected(url):
    with pytest.raises(UnsafeURLError):
        check_url(url)


def test_normalize_adds_scheme_and_strips_fragment():
    assert normalize_url("example.com/a#frag") == "https://example.com/a"


def test_canonical_dedupes_index_and_trailing_slash():
    assert canonical("https://x.com/a/index.html") == canonical("https://x.com/a/")


def test_extract_fields():
    html = """<html lang=en><head><title>Acme</title><meta name=description content="Tools">
    <script>steal()</script></head><body><nav>menu</nav><main><h1>Hello</h1>
    <p>Mail hi@acme.io</p><a href="/about">About</a><a href="https://github.com/acme">gh</a>
    <a href="tel:+1 555 0100">call</a></main></body></html>"""
    p = extract(html, "https://acme.io/")
    assert p["title"] == "Acme" and p["description"] == "Tools"
    assert "hi@acme.io" in p["emails"] and p["social"]["github"].startswith("https://github.com/acme")
    assert "steal" not in p["text_excerpt"] and "menu" not in p["text_excerpt"]
    assert "https://acme.io/about" in [l["url"] for l in p["links"]]


def test_crawl_stays_inside_the_section_and_ranks_by_focus():
    from sitecrawl.crawler import focus_terms, scope_prefix, score_link
    assert scope_prefix("https://github.com/owner/repo") == "/owner/repo"
    assert scope_prefix("https://x.com/docs/intro.html") == "/docs"
    assert scope_prefix("https://x.com/") == ""
    terms = focus_terms("how many commits does it have")
    assert terms == ["commit"]
    commits = {"url": "https://github.com/owner/repo/commits/main", "text": "6 Commits", "in_content": True}
    issues = {"url": "https://github.com/owner/repo/issues", "text": "Issues", "in_content": True}
    copilot = {"url": "https://github.com/features/copilot", "text": "Copilot", "in_content": False}
    s = lambda l: score_link(l, "/owner/repo", terms)
    assert s(commits) > s(issues) > s(copilot)


def test_follow_up_may_reuse_a_site_from_history_but_not_a_new_one():
    from app.intent import _allowed_hosts, _last_url
    from app.schemas import Turn
    hist = [Turn(prompt="tell me about https://github.com/owner/repo", url="https://github.com/owner/repo")]
    assert "github.com" in _allowed_hosts("how many commits does it have?", hist)
    assert "evil.example" not in _allowed_hosts("how many commits does it have?", hist)
    assert _last_url("and the architecture?", hist) == "https://github.com/owner/repo"


def run_cli(*args):
    r = subprocess.run([sys.executable, "-m", "sitecrawl", "crawl", *args], cwd=ROOT / "cli",
                       capture_output=True, text=True, timeout=30)
    return r.returncode, r.stdout, r.stderr


def test_cli_rejects_private_target_with_exit_5_and_valid_json():
    code, out, err = run_cli("--url", "http://127.0.0.1:80/")
    assert code == 5
    data = json.loads(out)
    assert data["status"] == "invalid_input" and data["pages"] == []
    assert all(json.loads(line) for line in err.strip().splitlines())


def test_cli_rejects_out_of_range_limits():
    code, _, _ = run_cli("--url", "https://example.com", "--max-pages", "999")
    assert code == 5


def test_backend_never_builds_shell_strings():
    from app.runner import build_argv
    from app.schemas import TaskSpec
    t = TaskSpec(action="crawl_site", url="https://example.com/;rm -rf /", max_pages=3, depth=1)
    argv = build_argv(t)
    assert isinstance(argv, list) and argv[argv.index("--url") + 1] == "https://example.com/;rm -rf /"
    t2 = TaskSpec(action="crawl_site", url="https://example.com", focus="pricing; $(reboot) `id`")
    a2 = build_argv(t2)
    assert "$" not in a2[a2.index("--focus") + 1] and "`" not in a2[a2.index("--focus") + 1]


def test_redaction():
    from app.security import redact
    assert "gsk_" not in redact("key gsk_" + "a" * 40)


def test_repeated_cards_become_records_with_exact_max_over_all_rows():
    from sitecrawl.extract import extract
    cards = "".join(
        f'<div class="row"><div class="col-md-4 country"><h3 class="country-name"><i class="flag"></i> {n}</h3>'
        f'<span class="country-capital">{c}</span><span class="country-area">{a}</span></div></div>'
        for n, c, a in [("Andorra", "Andorra la Vella", "468.0"), ("Antarctica", "None", "1.4E7"), ("Brazil", "Brasilia", "8511965.0"),
                        ("Chad", "N'Djamena", "1284000.0"), ("Russia", "Moscow", "1.71E7"), ("Zambia", "Lusaka", "752614.0")])
    page = extract(f"<html><body>{cards}{'filler text ' * 2000}</body></html>", "https://x.test/")
    rec = page["records"][0]
    assert rec["total"] == 6 and "country-area" in rec["columns"]
    assert rec["numeric_stats"]["country-area"]["max_row"] == "Russia"
    assert page["text_truncated"] is True


def test_context_puts_computed_facts_before_trimmed_text():
    from app.summarize import build_context
    page = {"url": "https://x.test/", "title": "t", "description": "", "headings": [], "text_excerpt": "a " * 5000,
            "text_truncated": True, "records": [{"selector": "div.country", "columns": ["name", "area"], "total": 2,
            "rows": [["A", "1"], ["B", "2"]], "numeric_stats": {"area": {"max": 2, "max_row": "B", "min": 1, "min_row": "A", "count": 2}}}]}
    ctx = build_context({"site": {}, "pages": [page]})
    assert "largest area = 2 (B)" in ctx and ctx.index("largest area") < ctx.index("Text")


def test_github_repo_urls_use_the_official_api_but_other_pages_do_not():
    from sitecrawl.github import repo_of
    assert repo_of("https://github.com/owner/repo/commits/main") == ("owner", "repo", "commits/main")
    assert repo_of("https://github.com/features/copilot") is None
    assert repo_of("https://gitlab.com/owner/repo") is None
