"""Canonical lecturer-facing quiz preview rendered from structured content."""

from __future__ import annotations

from typing import Any

RENDERER_VERSION = "quiz_markdown.v1"


def render_quiz_markdown(payload: dict[str, Any]) -> str:
    title = str(payload.get("title") or "Assessment Preview").strip()
    questions = payload.get("questions")
    if not isinstance(questions, list) or not questions:
        raise ValueError("quiz preview requires questions")
    total_points = sum(int(q.get("points") or 0) for q in questions if isinstance(q, dict))
    type_counts: dict[str, int] = {}
    for question in questions:
        if isinstance(question, dict):
            key = str(question.get("question_type") or "question")
            type_counts[key] = type_counts.get(key, 0) + 1
    lines = [
        f"# {title}", "", str(payload.get("description") or ""), "",
        f"**Week:** {payload.get('week')}  ",
        f"**Difficulty:** {payload.get('difficulty', 'medium')}  ",
        f"**Mode:** {payload.get('quiz_mode', 'mixed')}  ",
        f"**Questions:** {len(questions)}  ",
        f"**Total points:** {total_points}  ",
        f"**Time limit:** {payload.get('time_limit_minutes', 30)} minutes", "",
        "## Question Type Summary", "",
        "| Type | Count |", "|---|---:|",
    ]
    for qtype, count in type_counts.items():
        lines.append(f"| {qtype.replace('_', ' ').title()} | {count} |")
    labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    numbered = [(index, q) for index, q in enumerate(questions, start=1) if isinstance(q, dict)]
    for raw_type in ("multiple_choice", "short_answer", "true_false", "question"):
        grouped = [(index, q) for index, q in numbered if str(q.get("question_type") or "question") == raw_type]
        if not grouped:
            continue
        lines.extend(["", f"## {raw_type.replace('_', ' ').title()} Questions", ""])
        for index, question in grouped:
            lines.extend([
                f"### {index}. {question.get('question_text', '')}", "",
                f"*{question.get('points', 1)} point(s)*", "",
            ])
            for option_index, option in enumerate(question.get("options") or []):
                text = option.get("text", "") if isinstance(option, dict) else option
                label = labels[option_index] if option_index < len(labels) else "-"
                lines.append(f"- {label}. {text}")
            answer = str(question.get("correct_answer") or "")
            explanation = str(question.get("explanation") or "")
            if answer:
                lines.extend(["", f"**Correct answer:** {answer}"])
            if explanation:
                heading = "Expected criteria / marking guidance" if raw_type == "short_answer" else "Explanation"
                lines.extend(["", f"**{heading}:** {explanation}"])
            lines.append("")
    return "\n".join(lines).strip()
