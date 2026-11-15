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
    assert "https://acme.io/about" in p["links"]


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


def test_redaction():
    from app.security import redact
    assert "gsk_" not in redact("key gsk_" + "a" * 40)
