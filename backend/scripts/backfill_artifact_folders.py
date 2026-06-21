"""Backfill Drive folders/file names for existing artifacts in one batch.

Usage:
  uv run python scripts/backfill_artifact_folders.py <batch_id>

This is intentionally manual. It requires the batch lecturer to have valid
Google Workspace OAuth and does not run automatically.
"""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")

from services.google_workspace.drive_folders import (  # noqa: E402
    build_artifact_file_name,
    ensure_batch_artifact_folders,
    move_file_to_folder,
    rename_file,
)
from utils.firestore_client import get_firestore  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: backfill_artifact_folders.py <batch_id>")
    batch_id = sys.argv[1]

    db = get_firestore()
    batch_ref = db.collection("batches").document(batch_id)
    batch_snap = batch_ref.get()
    if not batch_snap.exists:
        raise SystemExit(f"Batch not found: {batch_id}")
    batch = batch_snap.to_dict() or {}
    lecturer_id = str(batch.get("lecturer_id") or "")
    if not lecturer_id:
        raise SystemExit("Batch has no lecturer_id")

    folders = ensure_batch_artifact_folders(
        uid=lecturer_id,
        batch_id=batch_id,
        batch_name=str(batch.get("batch_name") or ""),
        course_name=str(batch.get("course_name") or ""),
    )
    folder_map = folders["drive_folders"]

    for doc in batch_ref.collection("artifacts").stream():
        artifact = doc.to_dict() or {}
        artifact_type = str(artifact.get("type") or artifact.get("artifact_type") or "other")
        folder_key = "assessment" if artifact_type == "quiz" else artifact_type
        folder = folder_map.get(folder_key) or folder_map["other"]
        name = build_artifact_file_name(
            version=int(artifact.get("version") or 1),
            week=artifact.get("week"),
            artifact_type=artifact_type,
            title=str(artifact.get("title") or "Artifact"),
        )
        file_id = str(artifact.get("doc_id") or artifact.get("form_id") or "")
        if file_id:
            rename_file(lecturer_id, file_id, name)
            move_file_to_folder(lecturer_id, file_id, folder["id"])

        metadata = artifact.get("metadata") or {}
        student_doc_id = str(metadata.get("student_doc_id") or "")
        if artifact_type == "lab" and student_doc_id:
            student_name = build_artifact_file_name(
                version=int(artifact.get("version") or 1),
                week=artifact.get("week"),
                artifact_type="lab",
                title=str(artifact.get("title") or "Lab"),
                suffix="Student Instructions",
            )
            rename_file(lecturer_id, student_doc_id, student_name)
            move_file_to_folder(lecturer_id, student_doc_id, folder["id"])
            metadata["student_drive_file_name"] = student_name

        doc.reference.update(
            {
                "drive_file_name": name,
                "drive_folder_id": folder["id"],
                "drive_folder_url": folder["url"],
                "metadata": metadata,
            }
        )
        print(f"updated {doc.id}: {name}")


if __name__ == "__main__":
    main()
