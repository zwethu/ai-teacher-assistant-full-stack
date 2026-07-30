"""Read budget of the file-recovery sweep, and the local-cron opt-out.

Both exist because these run on a timer against Firestore whether or not anyone is
using the app, so their per-run document count is the thing that matters.
"""

from unittest.mock import MagicMock


def _file_doc(doc_id, batch_id="batch-1"):
    """A file stuck at index_status=pending, past the overlay build."""
    doc = MagicMock(); doc.id = doc_id
    doc.to_dict.return_value = {
        "batch_id": batch_id, "lecturer_id": "lect-1",
        "index_status": "pending", "overlay_status": "ready",
        "gcs_path": f"gs://bucket/{doc_id}", "file_title": doc_id,
        "vertex_import_completed_at": None,
    }
    return doc


def _sweep_db(monkeypatch, docs):
    """Wire a Firestore mock whose collection-group stream is lazy, so the test can
    observe how many documents the sweep actually pulls."""
    streamed = []

    def _stream():
        for doc in docs:
            streamed.append(doc.id)
            yield doc

    db = MagicMock()
    db.collection_group.return_value.where.return_value.limit.return_value.stream.side_effect = (
        lambda: _stream()
    )
    monkeypatch.setattr("services.file_service.get_firestore", lambda: db)
    return db, streamed


def test_sweep_reads_at_most_limit_docs(monkeypatch):
    """The three queries are streamed lazily and stop once the budget is filled.

    The previous version collected 3 x limit documents and then sliced off all but
    `limit` — paying for 60 reads to do 20 documents' worth of work.
    """
    from services import file_service as fs

    db, streamed = _sweep_db(monkeypatch, [_file_doc(f"file-{i}") for i in range(50)])
    monkeypatch.setattr(fs, "enqueue_index_batch_file", lambda *a, **kw: None)

    processed = fs.recover_batch_files(limit=20)

    assert processed == 20
    assert len(streamed) == 20
    # Budget filled by the first query, so the other two are never even built.
    assert db.collection_group.call_count == 1


def test_sweep_reads_each_batch_doc_once(monkeypatch):
    """Files cluster into a few batches; the batch doc must not be re-read per file."""
    from services import file_service as fs

    docs = [_file_doc(f"file-{i}", batch_id="batch-1") for i in range(5)]
    docs += [_file_doc(f"other-{i}", batch_id="batch-2") for i in range(5)]
    db, _ = _sweep_db(monkeypatch, docs)
    monkeypatch.setattr(fs, "enqueue_index_batch_file", lambda *a, **kw: None)

    # limit == len(docs) so the budget is filled by the first query alone; the mock
    # replays the same stream for every query, which real Firestore would not.
    assert fs.recover_batch_files(limit=10) == 10
    # Two distinct batches -> two reads, not ten.
    assert db.collection.return_value.document.call_count == 2


def test_local_cron_can_be_disabled(monkeypatch):
    """A dev server left running overnight should not sweep Firestore on a timer."""
    from services import maintenance_scheduler as ms

    monkeypatch.setattr("services.cloud_tasks.cloud_tasks_enabled", lambda: False)
    monkeypatch.setenv("MAINTENANCE_SCHEDULER_ENABLED", "false")
    ms.start_scheduler()
    assert ms._scheduler is None

    monkeypatch.setenv("MAINTENANCE_SCHEDULER_ENABLED", "true")
    try:
        ms.start_scheduler()
        assert ms._scheduler is not None and ms._scheduler.running
    finally:
        ms.shutdown_scheduler()
