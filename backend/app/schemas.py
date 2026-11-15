"""Typed contracts between the chat layer, the intent layer and the CLI."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from .config import settings


class ChatRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=settings.max_prompt_chars)

    @field_validator("prompt")
    @classmethod
    def strip_ctrl(cls, v: str) -> str:
        v = "".join(ch for ch in v if ch == "\n" or ch >= " ").strip()
        if not v:
            raise ValueError("prompt is empty")
        return v


Action = Literal["crawl_site", "clarify", "unsupported"]
Output = Literal["summary", "json"]


class TaskSpec(BaseModel):
    """What the intent layer is allowed to ask for. Anything else is rejected."""
    action: Action
    url: Optional[str] = None
    max_pages: int = Field(default=8, ge=1, le=settings.max_pages_cap)
    depth: int = Field(default=1, ge=0, le=settings.max_depth_cap)
    outputs: list[Output] = Field(default_factory=lambda: ["summary", "json"])
    focus: Optional[str] = Field(default=None, max_length=200)
    reply: Optional[str] = Field(default=None, max_length=400)
    interpreted_by: Literal["llm", "rules"] = "llm"

    @field_validator("outputs")
    @classmethod
    def dedupe(cls, v):
        return list(dict.fromkeys(v)) or ["summary", "json"]


class Insights(BaseModel):
    """LLM-written layer on top of the extracted data. Validated before use."""
    summary: str = Field(max_length=1500)
    key_points: list[str] = Field(default_factory=list, max_length=8)
    site_type: str = Field(default="", max_length=80)
    audience: str = Field(default="", max_length=160)
    topics: list[str] = Field(default_factory=list, max_length=10)
    focus_answer: Optional[str] = Field(default=None, max_length=800)
