"""Small security helpers: secret redaction, rate limiting, safe headers."""
from __future__ import annotations

import re
import time
from collections import defaultdict, deque

from .config import settings

_SECRET_PATTERNS = [
    re.compile(r"gsk_[A-Za-z0-9]{20,}"),           # Groq
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),           # OpenAI-style
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),      # GitHub
    re.compile(r"AIza[0-9A-Za-z_-]{30,}"),          # Google
    re.compile(r"(?i)(authorization|api[_-]?key|token|secret|password)\s*[:=]\s*\S+"),
]


def redact(text: str) -> str:
    """Remove anything that looks like a credential before it leaves the server."""
    if not text:
        return text
    if settings.groq_api_key:
        text = text.replace(settings.groq_api_key, "[REDACTED]")
    for pat in _SECRET_PATTERNS:
        text = pat.sub("[REDACTED]", text)
    return text


class RateLimiter:
    """Sliding-window limiter keyed by client IP (in-memory, single instance)."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> tuple[bool, int]:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= self.per_minute:
            return False, int(60 - (now - q[0])) + 1
        q.append(now)
        return True, 0


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; "
        "frame-ancestors 'self' https://huggingface.co https://*.hf.space; base-uri 'none'; form-action 'self'"
    ),
}
