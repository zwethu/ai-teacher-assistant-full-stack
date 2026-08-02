import unittest
from unittest.mock import patch

from entity.Batch import BatchUpdate
from services.batch_service import update_batch


class _Snapshot:
    def __init__(self, data):
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data) if self._data else {}


class _Document:
    def __init__(self, data):
        self.data = data
        self.update_calls = []

    def get(self):
        return _Snapshot(self.data)

    def update(self, fields):
        self.update_calls.append(fields)
        merged = dict(self.data)
        merged.update({k: v for k, v in fields.items() if k != "updated_at"})
        self.data = merged


class _Collection:
    def __init__(self, document):
        self._document = document

    def document(self, _document_id):
        return self._document


class _Firestore:
    def __init__(self, document):
        self._document = document

    def collection(self, _collection_name):
        return _Collection(self._document)


def _batch_doc(**overrides):
    data = {
        "batch_id": "b1",
        "batch_name": "Old Name",
        "course_name": "Old Course",
        "academic_year": "2025-2026",
        "term": "Semester 1",
        "lecturer_id": "lect-1",
        "lecturer_email": "lect@example.com",
    }
    data.update(overrides)
    return _Document(data)


class UpdateBatchTests(unittest.TestCase):
    def test_updates_fields_and_returns_refreshed_model(self):
        doc = _batch_doc()
        with patch("services.batch_service.get_firestore", return_value=_Firestore(doc)):
            result = update_batch(
                "b1",
                "lect-1",
                BatchUpdate(batch_name="New Name", course_name="New Course"),
            )

        self.assertIsNotNone(result)
        self.assertEqual(result.batch_name, "New Name")
        self.assertEqual(result.course_name, "New Course")
        self.assertEqual(len(doc.update_calls), 1)
        self.assertIn("updated_at", doc.update_calls[0])
        # Untouched fields are not written
        self.assertNotIn("term", doc.update_calls[0])

    def test_rejects_wrong_lecturer(self):
        doc = _batch_doc()
        with patch("services.batch_service.get_firestore", return_value=_Firestore(doc)):
            result = update_batch("b1", "someone-else", BatchUpdate(batch_name="X"))

        self.assertIsNone(result)
        self.assertEqual(doc.update_calls, [])

    def test_missing_batch_returns_none(self):
        doc = _Document(None)
        with patch("services.batch_service.get_firestore", return_value=_Firestore(doc)):
            result = update_batch("nope", "lect-1", BatchUpdate(batch_name="X"))

        self.assertIsNone(result)

    def test_blank_and_unchanged_values_are_noops(self):
        doc = _batch_doc()
        with patch("services.batch_service.get_firestore", return_value=_Firestore(doc)):
            result = update_batch(
                "b1",
                "lect-1",
                BatchUpdate(batch_name="   ", course_name="Old Course"),
            )

        self.assertIsNotNone(result)
        self.assertEqual(result.batch_name, "Old Name")
        self.assertEqual(doc.update_calls, [])

    def test_rename_triggers_drive_folder_rename_best_effort(self):
        doc = _batch_doc(drive_root_folder_id="folder-123")
        with patch("services.batch_service.get_firestore", return_value=_Firestore(doc)), patch(
            "services.google_workspace.drive_folders.rename_batch_root_folder"
        ) as rename:
            update_batch("b1", "lect-1", BatchUpdate(batch_name="Renamed"))

        rename.assert_called_once_with("lect-1", "folder-123", "Renamed")

    def test_drive_rename_failure_is_not_fatal(self):
        doc = _batch_doc(drive_root_folder_id="folder-123")
        with patch("services.batch_service.get_firestore", return_value=_Firestore(doc)), patch(
            "services.google_workspace.drive_folders.rename_batch_root_folder",
            side_effect=RuntimeError("no oauth"),
        ):
            result = update_batch("b1", "lect-1", BatchUpdate(batch_name="Renamed"))

        self.assertIsNotNone(result)
        self.assertEqual(result.batch_name, "Renamed")

    def test_no_drive_rename_without_folder_or_name_change(self):
        doc = _batch_doc()  # no drive_root_folder_id
        with patch("services.batch_service.get_firestore", return_value=_Firestore(doc)), patch(
            "services.google_workspace.drive_folders.rename_batch_root_folder"
        ) as rename:
            update_batch("b1", "lect-1", BatchUpdate(batch_name="Renamed"))
            update_batch("b1", "lect-1", BatchUpdate(course_name="Only Course"))

        rename.assert_not_called()


if __name__ == "__main__":
    unittest.main()
