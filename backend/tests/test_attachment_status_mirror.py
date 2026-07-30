"""Attachment readiness mirrored to RTDB so the composer can stop polling.

The mirror is additive: Firestore stays the source of truth and the HTTP endpoint
still answers, so every one of these also has to hold when RTDB is unconfigured.
"""

from unittest.mock import MagicMock

from services import chat_attachment_service as svc


def _capture_mirror(monkeypatch):
    written = []
    monkeypatch.setattr(
        "utils.rtdb_client.write_attachment_status",
        lambda chat_id, attachment_id, lecturer_id, payload: written.append(
            (chat_id, attachment_id, lecturer_id, payload)
        ),
    )
    return written


def test_mirror_carries_only_json_safe_readiness_fields(monkeypatch):
    """Firestore sentinels and datetimes are not serialisable to RTDB, and are not
    what the composer is waiting on — it wants `status`."""
    written = _capture_mirror(monkeypatch)

    svc._mirror_status_to_rtdb("chat-1", "att-1", "lect-1", {
        "status": "ready", "parse_status": "ready", "vision_status": "skipped",
        "token_estimate": 1290, "ocr_status": "not_needed",
        "chunk_status": "skipped", "embedding_status": "skipped",
        "rag_status": "skipped", "semantic_search_ready": False,
        "chunk_count": 0, "indexed_chars": 0,
        # Must not be forwarded:
        "expires_at": object(), "updated_at": object(), "gcs_path": "gs://bucket/x",
    })

    chat_id, attachment_id, lecturer_id, payload = written[0]
    assert (chat_id, attachment_id, lecturer_id) == ("chat-1", "att-1", "lect-1")
    assert payload["status"] == "ready"
    assert set(payload) <= set(svc._MIRRORED_STATUS_FIELDS)
    assert "expires_at" not in payload and "gcs_path" not in payload


def test_terminal_transition_is_mirrored(monkeypatch):
    """The single ref.update() in process_chat_attachment is the moment the file
    becomes usable, so it is the moment the composer needs to hear about."""
    written = _capture_mirror(monkeypatch)

    doc = {
        "attachment_id": "att-1", "batch_id": "b1", "chat_id": "c1",
        "lecturer_id": "lect-1", "status": "processing", "attachment_kind": "image",
        "content_type": "image/png", "gcs_path": "gs://bucket/x", "size_bytes": 10,
        "parse_status": "skipped", "vision_status": "pending",
    }
    snap = MagicMock(); snap.exists = True; snap.to_dict.return_value = doc
    ref = MagicMock(); ref.get.return_value = snap
    monkeypatch.setattr(svc, "attachment_ref", lambda *a: ref)
    monkeypatch.setattr(svc, "download_bytes", lambda *a, **kw: b"")
    monkeypatch.delenv("ATTACHMENT_VISION_MODEL", raising=False)

    svc.process_chat_attachment("b1", "c1", "att-1")

    assert ref.update.called, "Firestore remains the source of truth"
    assert written, "the composer is not told the file is ready"
    assert written[-1][1] == "att-1" and written[-1][2] == "lect-1"
    assert written[-1][3]["status"] in {"ready", "failed", "too_large"}


def test_duplicate_delivery_does_not_emit_a_second_transition(monkeypatch):
    """Cloud Tasks may deliver twice; the processing guard must cover the mirror
    too, or the composer sees a settled file flip state again."""
    written = _capture_mirror(monkeypatch)

    snap = MagicMock(); snap.exists = True
    snap.to_dict.return_value = {"status": "ready", "lecturer_id": "lect-1"}
    ref = MagicMock(); ref.get.return_value = snap
    monkeypatch.setattr(svc, "attachment_ref", lambda *a: ref)

    svc.process_chat_attachment("b1", "c1", "att-1")

    assert ref.update.call_count == 0
    assert written == []


def test_timeout_is_mirrored(monkeypatch):
    """fail_stuck_attachment releases a wedged run; the composer must stop spinning."""
    written = _capture_mirror(monkeypatch)

    snap = MagicMock()
    snap.to_dict.return_value = {"status": "processing", "lecturer_id": "lect-1"}
    ref = MagicMock(); ref.get.return_value = snap
    monkeypatch.setattr(svc, "attachment_ref", lambda *a: ref)

    svc.fail_stuck_attachment("b1", "c1", "att-1")

    assert written[-1][3]["status"] == "failed"


def test_mirror_never_raises_when_rtdb_is_unavailable(monkeypatch):
    """RTDB is best-effort. If it throws, upload and processing must still succeed —
    the client falls back to polling the HTTP endpoint."""
    def _boom(*args, **kwargs):
        raise RuntimeError("rtdb down")

    monkeypatch.setattr("utils.rtdb_client._ensure_init", lambda: True)
    monkeypatch.setattr("utils.rtdb_client._ref", _boom)

    # Goes through the real writer, whose contract is to swallow and warn.
    svc._mirror_status_to_rtdb("chat-1", "att-1", "lect-1", {"status": "ready"})
