"""Canonical lecturer-facing quiz preview rendered from structured content."""

from __future__ import annotations

from typing import Any

RENDERER_VERSION = "quiz_markdown.v1"


def render_quiz_markdown(payload: dict[str, Any]) -> str:
    title = str(payload.get("title") or "Assessment Preview").strip()
    questions = payload.get("questions")
    if not isinstance(questions, list) or not questions:
        raise ValueError("quiz preview requires questions")
    lines = [
        f"# {title}", "", str(payload.get("description") or ""), "",
        f"**Week:** {payload.get('week')}  ",
        f"**Difficulty:** {payload.get('difficulty', 'medium')}  ",
        f"**Time limit:** {payload.get('time_limit_minutes', 30)} minutes", "",
        "## Questions", "",
    ]
    labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    for index, question in enumerate(questions, start=1):
        if not isinstance(question, dict):
            continue
        qtype = str(question.get("question_type") or "question").replace("_", " ").title()
        lines.extend([
            f"### {index}. {question.get('question_text', '')}", "",
            f"*{qtype} · {question.get('points', 1)} point(s)*", "",
        ])
        options = question.get("options") or []
        for option_index, option in enumerate(options):
            text = option.get("text", "") if isinstance(option, dict) else option
            label = labels[option_index] if option_index < len(labels) else "-"
            lines.append(f"- {label}. {text}")
        answer = str(question.get("correct_answer") or "")
        explanation = str(question.get("explanation") or "")
        if answer:
            lines.extend(["", f"**Answer:** {answer}"])
        if explanation:
            lines.extend(["", f"**Explanation:** {explanation}"])
        lines.append("")
    return "\n".join(lines).strip()
