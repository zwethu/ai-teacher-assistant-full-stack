import unittest

from services.artifact_export_validation import validate_rendered_blocks_coverage
from services.google_workspace.docs_rendering.builder import BlockType, TextBlock


class ArtifactExportValidationTests(unittest.TestCase):
    def test_lab_config_templates_match_multiline_rendered_blocks(self):
        payload = {
            "title": "Firebase Guestbook Lab",
            "procedure_steps": [
                {
                    "config_templates": [
                        {
                            "title": "Firebase config",
                            "code": "const firebaseConfig = {\n"
                            "  apiKey: 'your_api_key',\n"
                            "  authDomain: 'your_project.firebaseapp.com'\n"
                            "};",
                        }
                    ],
                }
            ],
        }
        blocks = [
            TextBlock(BlockType.TITLE, "Firebase Guestbook Lab"),
            TextBlock(BlockType.HEADING1, "Learning Objectives"),
            TextBlock(BlockType.HEADING1, "Environment Setup"),
            TextBlock(BlockType.HEADING1, "Instructor Walkthrough"),
            TextBlock(BlockType.HEADING1, "Checkpoints"),
            TextBlock(BlockType.HEADING1, "Rubric"),
            TextBlock(BlockType.HEADING2, "Configuration Templates"),
            TextBlock(
                BlockType.BODY,
                "Firebase config\n```javascript\n"
                "const firebaseConfig = {\n"
                "  apiKey: 'your_api_key',\n"
                "  authDomain: 'your_project.firebaseapp.com'\n"
                "};\n```",
            ),
        ]

        validate_rendered_blocks_coverage("lab", payload, blocks, mode="lecturer")


if __name__ == "__main__":
    unittest.main()
