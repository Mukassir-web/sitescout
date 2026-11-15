"""Runtime configuration, read once from environment variables."""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    groq_api_key: str = field(default_factory=lambda: os.getenv("GROQ_API_KEY", ""), repr=False)
    groq_base_url: str = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    intent_model: str = os.getenv("INTENT_MODEL", "openai/gpt-oss-20b")
    summary_model: str = os.getenv("SUMMARY_MODEL", "openai/gpt-oss-120b")
    guard_model: str = os.getenv("GUARD_MODEL", "meta-llama/llama-prompt-guard-2-86m")
    llm_timeout_s: float = float(os.getenv("LLM_TIMEOUT_S", "25"))

    # Execution limits (the CLI enforces its own hard caps as well)
    max_pages_cap: int = _int("MAX_PAGES_CAP", 20)
    max_depth_cap: int = _int("MAX_DEPTH_CAP", 2)
    crawl_timeout_s: int = _int("CRAWL_TIMEOUT_S", 45)
    process_grace_s: int = _int("PROCESS_GRACE_S", 15)
    max_concurrent_runs: int = _int("MAX_CONCURRENT_RUNS", 3)
    max_stdout_bytes: int = _int("MAX_STDOUT_BYTES", 6_000_000)

    # Abuse protection
    rate_limit_per_min: int = _int("RATE_LIMIT_PER_MIN", 8)
    max_prompt_chars: int = _int("MAX_PROMPT_CHARS", 1500)
    allowed_origins: tuple = tuple(o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip())

    python_bin: str = sys.executable
    cli_dir: Path = Path(os.getenv("CLI_DIR", Path(__file__).resolve().parents[2] / "cli"))
    static_dir: Path = Path(os.getenv("STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))

    @property
    def llm_enabled(self) -> bool:
        return bool(self.groq_api_key)


settings = Settings()
