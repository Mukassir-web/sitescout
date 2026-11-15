"""Structured progress events. One JSON object per line on stderr.

stdout is reserved for the final result so the caller can parse it cleanly.
"""
from __future__ import annotations

import json
import sys
import time

_T0 = time.perf_counter()
QUIET_LEVELS: set[str] = set()


def emit(level: str, event: str, **fields) -> None:
    if level in QUIET_LEVELS:
        return
    rec = {"t": round(time.perf_counter() - _T0, 3), "level": level, "event": event, **fields}
    sys.stderr.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
    sys.stderr.flush()
