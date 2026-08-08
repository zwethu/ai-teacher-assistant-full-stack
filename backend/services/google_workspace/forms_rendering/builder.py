"""Google Forms batchUpdate request builders.

Copied from Pnai-ai/mila/tools/google_forms/builder.py
"""

from __future__ import annotations

from typing import Any


def text_item_request(
    title: str,
    description: str,
    index: int,
) -> dict[str, Any]:
    """Build a non-question text block for Form structure/instructions."""
    return {
        "createItem": {
            "item": {
                "title": title,
                "description": description,
                "textItem": {},
            },
            "location": {"index": index},
        }
    }


def build_intro_requests(quiz_payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build themed overview blocks mirroring the Docs/Lab export structure."""
    questions = quiz_payload.get("questions") or []
    total_points = sum(int(question.get("points") or 0) for question in questions)
    overview_lines = [
        f"Batch: {quiz_payload.get('batch_name') or 'N/A'}",
        f"Week: {quiz_payload.get('week') or 'N/A'}",
        f"Difficulty: {quiz_payload.get('difficulty') or 'medium'}",
        f"Mode: {quiz_payload.get('quiz_mode') or 'mixed'}",
        f"Questions: {len(questions)}",
        f"Total points: {total_points}",
        f"Time limit: {quiz_payload.get('time_limit_minutes') or 30} minutes",
    ]
    description = str(quiz_payload.get("description") or "").strip()
    instruction_lines = [
        description,
        "Answer all questions. Multiple-choice and true/false items are graded automatically.",
        "Short-answer items include guidance for review and may require teacher checking.",
    ]
    return [
        text_item_request("Assessment Overview", "\n".join(overview_lines), 0),
        text_item_request(
            "Instructions",
            "\n".join(line for line in instruction_lines if line),
            1,
        ),
    ]


def choice_question_request(
    question_text: str,
    options: list[str],
    correct_answer: str,
    points: int,
    explanation: str,
    index: int,
    description: str = "",
) -> dict[str, Any]:
    if not correct_answer:
        preview = question_text[:40]
        raise ValueError(
            f"Multiple choice question '{preview}' has no correct_answer. Cannot create quiz."
        )
    return {
        "createItem": {
            "item": {
                "title": question_text,
                "description": description,
                "questionItem": {
                    "question": {
                        "required": True,
                        "grading": {
                            "pointValue": points,
                            "correctAnswers": {
                                "answers": [{"value": correct_answer}],
                            },
                            "whenRight": {"text": "Correct!"},
                            "whenWrong": {
                                "text": explanation or "Incorrect.",
                            },
                        },
                        "choiceQuestion": {
                            "type": "RADIO",
                            "options": [{"value": str(opt)} for opt in options],
                            "shuffle": False,
                        },
                    }
                },
            },
            "location": {"index": index},
        }
    }


def build_question_request(question: dict[str, Any], index: int) -> dict[str, Any]:
    """Build a createItem request from a simplified question dict."""
    if "createItem" in question:
        item = dict(question)
        item["createItem"] = dict(item["createItem"])
        item["createItem"]["location"] = {"index": index}
        return item

    question_type = question.get("question_type", "multiple_choice")
    question_text = question.get("question_text", "")
    raw_options = question.get("options") or []
    options = [
        str(opt.get("text", ""))
        if isinstance(opt, dict)
        else str(opt)
        for opt in raw_options
    ]
    correct_answer = str(question.get("correct_answer", ""))
    if not correct_answer:
        correct_answer = next(
            (
                str(opt.get("text", ""))
                for opt in raw_options
                if isinstance(opt, dict) and opt.get("is_correct")
            ),
            "",
        )
    points = int(question.get("points", 1))
    explanation = question.get("explanation") or ""
    difficulty = str(question.get("difficulty") or "medium")
    description = (
        f"Type: {question_type.replace('_', ' ').title()} | "
        f"Difficulty: {difficulty.title()} | Points: {points}"
    )

    if question_type == "true_false":
        options = ["True", "False"]
        return choice_question_request(
            question_text, options, correct_answer, points, explanation, index, description
        )
    if question_type == "short_answer":
        return {
            "createItem": {
                "item": {
                    "title": question_text,
                    "description": description,
                    "questionItem": {
                        "question": {
                            "required": True,
                            "grading": {
                                "pointValue": points,
                                "generalFeedback": {"text": explanation},
                            },
                            "textQuestion": {"paragraph": False},
                        }
                    },
                },
                "location": {"index": index},
            }
        }
    if question_type == "multiple_choice":
        return choice_question_request(
            question_text, options, correct_answer, points, explanation, index, description
        )
    raise ValueError(f"Unsupported question_type: {question_type}")
