"""Google Forms batchUpdate request builders.

Copied from Pnai-ai/pnai/tools/google_forms/builder.py
"""

from __future__ import annotations

from typing import Any


def choice_question_request(
    question_text: str,
    options: list[str],
    correct_answer: str,
    points: int,
    explanation: str,
    index: int,
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
    options = question.get("options") or []
    correct_answer = str(question.get("correct_answer", ""))
    points = int(question.get("points", 1))
    explanation = question.get("explanation") or ""

    if question_type == "true_false":
        options = ["True", "False"]
        return choice_question_request(
            question_text, options, correct_answer, points, explanation, index
        )
    if question_type == "short_answer":
        return {
            "createItem": {
                "item": {
                    "title": question_text,
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
            question_text, options, correct_answer, points, explanation, index
        )
    raise ValueError(f"Unsupported question_type: {question_type}")
