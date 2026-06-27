import unittest

from services.artifact_export_validation import validate_rendered_blocks_coverage
from services.google_workspace.docs_rendering.builder import BlockType, TextBlock
from services.artifact_renderers.code_blocks import normalize_code_block, render_code_block
from services.google_workspace.docs_rendering.renderer import render_phases


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
            TextBlock(BlockType.META, "Firebase config"),
            TextBlock(
                BlockType.CODE,
                "const firebaseConfig = {\n"
                "  apiKey: 'your_api_key',\n"
                "  authDomain: 'your_project.firebaseapp.com'\n"
                "};",
            ),
        ]

        validate_rendered_blocks_coverage("lab", payload, blocks, mode="lecturer")

    def test_code_normalizer_strips_fences_and_infers_powerfx(self):
        value = "```\nIf(ThisItem.IsSelected, RGBA(230,242,255,1), RGBA(0,0,0,0))\n```"
        normalized = normalize_code_block(value)
        self.assertEqual(normalized["language"], "powerfx")
        self.assertNotIn("```", normalized["code"])
        markdown = "\n".join(render_code_block(value))
        self.assertIn("```powerfx", markdown)

    def test_docs_code_block_is_monospace_without_literal_fences(self):
        content, styles = render_phases([TextBlock(BlockType.CODE, "SubmitForm(EditForm1)")])
        inserted = content[0]["insertText"]["text"]
        self.assertNotIn("```", inserted)
        self.assertIn("SubmitForm", inserted)
        style = styles[0]["updateTextStyle"]["textStyle"]
        self.assertEqual(style["weightedFontFamily"]["fontFamily"], "Courier New")
        self.assertIn("backgroundColor", style)


if __name__ == "__main__":
    unittest.main()
