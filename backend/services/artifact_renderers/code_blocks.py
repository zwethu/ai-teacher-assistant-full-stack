"""Deterministic normalization and Markdown rendering for code/config snippets."""

from __future__ import annotations

import json
import re
from typing import Any


def normalize_code_block(
    value: dict[str, Any] | str,
    default_language: str = "text",
) -> dict[str, str] | None:
    if isinstance(value, dict):
        title = str(value.get("title") or value.get("name") or "").strip()
        language = str(value.get("language") or value.get("type") or "").strip().lower()
        code = str(
            value.get("code")
            or value.get("content")
            or value.get("text")
            or value.get("value")
            or ""
        ).strip()
    else:
        title = ""
        language = ""
        code = str(value).strip()
    if not code:
        return None
    fence = re.fullmatch(r"```([\w.+-]*)\s*\n([\s\S]*?)\n?```", code)
    if fence:
        language = language or fence.group(1)
        code = fence.group(2).strip("\n")
    language = language or infer_code_language(code) or default_language
    return {"title": title, "language": language, "code": code}


def infer_code_language(code: str) -> str:
    text = code.strip()
    lower = text.lower()
    if not text:
        return "text"
    if re.search(r"\b(if|newform|submitform|notify|patch|set|navigate)\s*\(", text, re.I):
        return "powerfx"
    if (text.startswith("{") or text.startswith("[")):
        try:
            json.loads(text)
            return "json"
        except json.JSONDecodeError:
            pass
    if re.search(r"<!doctype html|<html|<div|<section|<form", lower):
        return "html"
    if re.search(r"\b(def |import |from \w+ import|print\()", text):
        return "python"
    if re.search(r"\b(const|let|var|function|=>|console\.log)\b", text):
        return "javascript"
    return "text"


def render_code_block(value: dict[str, Any] | str, default_language: str = "text") -> list[str]:
    block = normalize_code_block(value, default_language)
    if block is None:
        return []
    lines: list[str] = []
    if block["title"]:
        lines.extend([f"**{block['title']}**", ""])
    lines.extend([f"```{block['language']}", block["code"], "```"])
    return lines
