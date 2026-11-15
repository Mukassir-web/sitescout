"""Minimal Groq (OpenAI-compatible) client. No SDK, no key ever logged."""
from __future__ import annotations

import json

import httpx

from .config import settings


class LLMError(RuntimeError):
    pass


_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=settings.groq_base_url,
            timeout=settings.llm_timeout_s,
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
        )
    return _client


async def chat_json(model: str, system: str, user: str, max_tokens: int = 1200) -> dict:
    if not settings.llm_enabled:
        raise LLMError("LLM disabled (no GROQ_API_KEY)")
    body = {
        "model": model,
        "temperature": 0.2,
        "max_completion_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    if model.startswith("openai/gpt-oss"):
        body.update(reasoning_effort="low", include_reasoning=False)
    try:
        r = await client().post("/chat/completions", json=body)
    except httpx.HTTPError as exc:
        raise LLMError(f"LLM request failed: {type(exc).__name__}") from exc
    if r.status_code != 200:
        raise LLMError(f"LLM returned HTTP {r.status_code}")
    try:
        content = r.json()["choices"][0]["message"]["content"]
        return json.loads(content)
    except (KeyError, IndexError, ValueError) as exc:
        raise LLMError("LLM returned malformed JSON") from exc


async def injection_score(text: str) -> float | None:
    """Llama Prompt Guard 2: probability that text is a prompt-injection / jailbreak."""
    if not settings.llm_enabled or not text.strip():
        return None
    try:
        r = await client().post("/chat/completions", json={
            "model": settings.guard_model,
            "messages": [{"role": "user", "content": text[:1800]}],
        }, timeout=8)
        if r.status_code != 200:
            return None
        return float(r.json()["choices"][0]["message"]["content"].strip())
    except Exception:
        return None
