"""Optional Gemini embeddings for temporary chat-file retrieval."""
from __future__ import annotations

import os
from typing import Iterable


def embeddings_enabled() -> bool:
    return os.getenv("CHAT_FILE_EMBEDDINGS_ENABLED", "false").lower() == "true"


def embedding_dimensions() -> int:
    try:
        value = int(os.getenv("CHAT_FILE_EMBEDDING_DIMENSIONS", "768"))
    except ValueError:
        value = 768
    return max(256, min(value, 2048))


def embed_texts(texts: Iterable[str], *, task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    values = [str(text).strip() for text in texts]
    if not values:
        return []
    from google import genai
    from google.genai import types

    client = genai.Client(
        vertexai=True,
        project=os.getenv("GOOGLE_CLOUD_PROJECT") or None,
        location=os.getenv("GOOGLE_CLOUD_LOCATION") or "global",
    )
    output: list[list[float]] = []
    for start in range(0, len(values), 16):
        group = values[start:start + 16]
        response = client.models.embed_content(
            model=os.getenv("CHAT_FILE_EMBEDDING_MODEL") or "gemini-embedding-001",
            contents=group,
            config=types.EmbedContentConfig(
                task_type=task_type,
                output_dimensionality=embedding_dimensions(),
            ),
        )
        embeddings = response.embeddings or []
        if len(embeddings) != len(group):
            raise RuntimeError("Embedding response count did not match input count.")
        output.extend(list(item.values or []) for item in embeddings)
    return output
