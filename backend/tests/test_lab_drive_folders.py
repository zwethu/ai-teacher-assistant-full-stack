import unittest
from unittest.mock import patch

from services.google_workspace.drive_folders import (
    FOLDER_KEYS,
    ensure_batch_artifact_folders,
)


class _Snapshot:
    def __init__(self, data):
        self._data = data

    def to_dict(self):
        return self._data


class _Document:
    def __init__(self, data):
        self.data = data
        self.updated = None

    def get(self):
        return _Snapshot(self.data)

    def update(self, data):
        self.updated = data


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


def _folder(name, folder_id, parent_id=""):
    return {
        "id": folder_id,
        "name": name,
        "url": f"https://drive.google.com/drive/folders/{folder_id}",
        "parent_id": parent_id,
    }


class LabDriveFolderTests(unittest.TestCase):
    def test_ensure_batch_artifact_folders_creates_lab_nested_folders_under_labs(self):
        batch_doc = _Document({})

        def create_folder(_uid, name, parent_id=None):
            folder_id = name.lower().replace(" ", "-")
            return _folder(name, folder_id, parent_id or "")

        with (
            patch("services.google_workspace.drive_folders.get_firestore", return_value=_Firestore(batch_doc)),
            patch("services.google_workspace.drive_folders._valid_folder", return_value=None),
            patch(
                "services.google_workspace.drive_folders.get_or_create_folder",
                side_effect=create_folder,
            ) as mock_create,
        ):
            result = ensure_batch_artifact_folders(
                uid="lecturer-1",
                batch_id="batch-1",
                batch_name="Low Code 2026",
                course_name="Low Code",
            )

        folders = result["drive_folders"]
        self.assertEqual(tuple(FOLDER_KEYS), ("lesson_plan", "lab", "assessment", "email", "other"))
        self.assertEqual(folders["lab"]["name"], "Labs")
        self.assertEqual(folders["lab_lecturer"]["name"], "Lecturer Guides")
        self.assertEqual(folders["lab_student"]["name"], "Student Instructions")
        self.assertEqual(folders["lab_lecturer"]["parent_id"], folders["lab"]["id"])
        self.assertEqual(folders["lab_student"]["parent_id"], folders["lab"]["id"])
        self.assertIn("lab_lecturer", batch_doc.updated["drive_folders"])
        self.assertIn("lab_student", batch_doc.updated["drive_folders"])

        created_names = [call.args[1] for call in mock_create.call_args_list]
        self.assertIn("Labs", created_names)
        self.assertIn("Lecturer Guides", created_names)
        self.assertIn("Student Instructions", created_names)

    def test_ensure_batch_artifact_folders_keeps_labs_fallback_when_nested_creation_fails(self):
        batch_doc = _Document({})

        def create_folder(_uid, name, parent_id=None):
            if name in {"Lecturer Guides", "Student Instructions"}:
                raise RuntimeError("Drive folder creation failed")
            folder_id = name.lower().replace(" ", "-")
            return _folder(name, folder_id, parent_id or "")

        with (
            patch("services.google_workspace.drive_folders.get_firestore", return_value=_Firestore(batch_doc)),
            patch("services.google_workspace.drive_folders._valid_folder", return_value=None),
            patch(
                "services.google_workspace.drive_folders.get_or_create_folder",
                side_effect=create_folder,
            ),
        ):
            result = ensure_batch_artifact_folders(
                uid="lecturer-1",
                batch_id="batch-1",
                batch_name="Low Code 2026",
                course_name="Low Code",
            )

        folders = result["drive_folders"]
        self.assertEqual(folders["lab"]["name"], "Labs")
        self.assertNotIn("lab_lecturer", folders)
        self.assertNotIn("lab_student", folders)


if __name__ == "__main__":
    unittest.main()
