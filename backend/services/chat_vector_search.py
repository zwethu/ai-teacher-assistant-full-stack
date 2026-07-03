"""Scoped hybrid retrieval over temporary chat attachment chunks."""
from __future__ import annotations

import math
import os
import re
from datetime import datetime, timezone
from typing import Any

from google.cloud.firestore_v1.base_vector_query import DistanceMeasure

from services.chat_embedding_service import embed_texts, embeddings_enabled
from utils.firestore_client import get_firestore


def _terms(text: str) -> set[str]:
    return set(re.findall(r"[\w-]{2,}", text.lower()))


def _expired(value: Any) -> bool:
    if isinstance(value, str):
        try: value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError: return True
    return bool(value and value <= datetime.now(timezone.utc))


def search_chat_attachment_chunks(batch_id: str, chat_id: str, lecturer_id: str, query: str, attachment_ids: list[str] | None = None, max_results: int = 8) -> dict[str, Any]:
    limit = max(1, min(int(max_results), 10)); query = str(query or "")[:500]
    if not query.strip():
        return {"status": "empty", "query": query, "hits": [], "retrieval_mode": "unavailable"}
    db = get_firestore(); chat_ref = db.collection("batches").document(batch_id).collection("chats").document(chat_id)
    chat_snap = chat_ref.get(); chat = chat_snap.to_dict() or {}
    if not chat_snap.exists or chat.get("lecturer_id") != lecturer_id or chat.get("hidden", False):
        return {"status": "empty", "query": query, "hits": [], "retrieval_mode": "unavailable"}
    ids = list(dict.fromkeys(attachment_ids or []))[:10]
    for attachment_id in ids:
        snap = chat_ref.collection("attachments").document(attachment_id).get(); data = snap.to_dict() or {}
        if not snap.exists or data.get("lecturer_id") != lecturer_id or data.get("scope") != "chat" or _expired(data.get("expires_at")):
            return {"status": "empty", "query": query, "hits": [], "retrieval_mode": "unavailable"}

    base = db.collection_group("chunks").where("batch_id", "==", batch_id).where("chat_id", "==", chat_id).where("lecturer_id", "==", lecturer_id).where("expires_at", ">", datetime.now(timezone.utc))
    if ids:
        base = base.where("attachment_id", "in", ids)
    lexical_docs = list(base.limit(500).stream()) if os.getenv("CHAT_FILE_RAG_LEXICAL_FALLBACK", "true").lower() == "true" else []
    qterms = _terms(query); lexical: dict[tuple[str, int], tuple[float, dict[str, Any]]] = {}
    for doc in lexical_docs:
        data = doc.to_dict() or {}; text = str(data.get("text") or "")
        overlap = len(qterms & _terms(text + " " + str(data.get("file_title") or "")))
        if qterms and not overlap: continue
        score = overlap / max(1, math.sqrt(len(qterms)))
        lexical[(str(data.get("attachment_id")), int(data.get("chunk_index") or 0))] = (score, data)

    semantic: dict[tuple[str, int], tuple[float, dict[str, Any]]] = {}
    if embeddings_enabled() and query.strip():
        try:
            vector = embed_texts([query], task_type="RETRIEVAL_QUERY")[0]
            for doc in base.find_nearest("embedding", vector, limit=min(limit * 3, 30), distance_measure=DistanceMeasure.COSINE, distance_result_field="vector_distance").stream():
                data = doc.to_dict() or {}; distance = float(data.get("vector_distance") or 0)
                semantic[(str(data.get("attachment_id")), int(data.get("chunk_index") or 0))] = (max(0.0, 1.0 - distance), data)
        except Exception:
            semantic = {}

    keys = set(lexical) | set(semantic); ranked = []
    for key in keys:
        if key in lexical:
            lex_score, data = lexical[key]
        else:
            lex_score, data = 0.0, semantic[key][1]
        sem_score = semantic.get(key, (0.0, data))[0]
        lane = "hybrid" if key in lexical and key in semantic else ("semantic_vector" if key in semantic else "lexical")
        ranked.append((sem_score + lex_score, data, lane))
    hits = []
    live: dict[str, bool] = {}
    for score, data, lane in sorted(ranked, key=lambda item: (-item[0], str(item[1].get("attachment_id")), int(item[1].get("chunk_index") or 0))):
        attachment_id = str(data.get("attachment_id") or "")
        if attachment_id not in live:
            parent = chat_ref.collection("attachments").document(attachment_id).get(); parent_data = parent.to_dict() or {}
            live[attachment_id] = bool(parent.exists and parent_data.get("lecturer_id") == lecturer_id and parent_data.get("scope") == "chat" and not _expired(parent_data.get("expires_at")))
        if not live[attachment_id]:
            continue
        hits.append({key: data.get(key) for key in ("attachment_id", "file_name", "file_title", "attachment_kind", "content_type", "chunk_index", "page_number", "expires_at")} | {"snippet": str(data.get("text") or "")[:1800], "source": "chat_attachment", "retrieval_lane": lane, "score": round(score, 6)})
        if len(hits) >= limit:
            break
    mode = "hybrid" if semantic and lexical else ("semantic_vector" if semantic else "lexical")
    return {"status": "success" if hits else "empty", "query": query, "hits": hits, "retrieval_mode": mode}
