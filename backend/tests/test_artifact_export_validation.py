import unittest

from services.artifact_export_validation import (
    ArtifactExportCoverageError,
    lab_topic_gaps,
    validate_export_coverage,
    validate_rendered_blocks_coverage,
)
from services.google_workspace.docs_rendering import theme
from services.google_workspace.docs_rendering.builder import BlockType, TextBlock
from services.artifact_renderers.code_blocks import normalize_code_block, render_code_block
from services.artifact_renderers.lab_markdown import _append_code_blocks as append_lab_code_blocks
from services.google_workspace.docs_rendering.lab_builder import LabDocBuilder
from services.google_workspace.docs_rendering.renderer import render_phases
from types import SimpleNamespace


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

    def test_empty_code_blocks_do_not_render_sections_or_docs_blocks(self):
        for value in ({}, "", "   ", {"title": "No code"}):
            self.assertIsNone(normalize_code_block(value))
            self.assertEqual(render_code_block(value), [])

        lines: list[str] = []
        append_lab_code_blocks(lines, "Code Blocks", [{}, "   "])
        self.assertEqual(lines, [])

        blocks = []
        LabDocBuilder._append_rich_step_blocks(
            blocks,
            SimpleNamespace(
                prompt_templates=[""],
                code_blocks=[{}],
                config_templates=[{"title": "Empty"}],
                common_errors=[],
                recovery_actions=[],
            ),
            include_recovery=False,
        )
        self.assertEqual(blocks, [])

    def test_valid_dict_code_block_still_renders(self):
        value = {"title": "Save formula", "language": "powerfx", "code": "SubmitForm(Form1)"}
        normalized = normalize_code_block(value)
        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["language"], "powerfx")
        markdown = "\n".join(render_code_block(value))
        self.assertIn("Save formula", markdown)
        self.assertIn("SubmitForm(Form1)", markdown)

    def test_docs_code_block_is_monospace_without_literal_fences(self):
        content, styles = render_phases([TextBlock(BlockType.CODE, "SubmitForm(EditForm1)")])
        inserted = content[0]["insertText"]["text"]
        self.assertNotIn("```", inserted)
        self.assertIn("SubmitForm", inserted)
        text_styles = [r["updateTextStyle"] for r in styles if "updateTextStyle" in r]
        style = text_styles[0]["textStyle"]
        self.assertEqual(style["weightedFontFamily"]["fontFamily"], theme.FONT_CODE)
        # The block reads as code via full-width paragraph shading, not
        # per-character background highlighting.
        para_styles = [r["updateParagraphStyle"] for r in styles if "updateParagraphStyle" in r]
        self.assertIn("shading", para_styles[0]["paragraphStyle"])


def _lab(**over):
    """A complete lab, so a coverage failure is only ever about the topic checks."""
    payload = {
        "title": "Week 5 Lab: Retool Support Ticket Admin Portal",
        "learning_objectives": ["Build a CRUD admin portal on PostgreSQL"],
        "environment_profile": {"required_software": ["Retool Cloud", "psql"]},
        "procedure_steps": [{"step_number": 1, "title": "Connect the database"}],
        "checkpoints": ["Portal lists tickets"],
        "deliverables": ["A published Retool app"],
        "rubric": [{"criterion": "Works", "points": 10}],
    }
    payload.update(over)
    return payload


class LabExportBlockingTests(unittest.TestCase):
    """What may stop an export: absent sections, and nothing else.

    Three well-formed labs were refused in a row by topic keyword checks — see
    `lab_topic_gaps` for what each one was and why no keyword could have got it
    right. Those checks are advisory now; these are the ones that still bite.
    """

    def test_a_lab_missing_its_sections_is_refused(self):
        with self.assertRaises(ArtifactExportCoverageError) as caught:
            validate_export_coverage("lab", {"title": "Half a lab"})
        message = str(caught.exception)
        for section in ("learning objectives", "procedure steps", "rubric"):
            self.assertIn(section, message)

    def test_topic_coverage_never_blocks_an_otherwise_complete_lab(self):
        # The n8n lab: `firebase-admin` server-side, no browser client, and its
        # access-control note phrased as "Firestore rules" rather than the
        # literal "security rules" the checklist looked for.
        payload = _lab(
            title="Week 6: Workflow Automation with n8n (Integrating the Firebase/Retool Stack)",
            environment_profile={"required_packages": ["firebase-admin", "n8n (run via npx)"]},
            learning_objectives=["Authenticate n8n with Cloud Firestore using a service account"],
        )

        validate_export_coverage("lab", payload)

    def test_every_real_shape_that_used_to_be_refused_now_exports(self):
        for name, payload in _labs_that_were_refused().items():
            with self.subTest(name):
                validate_export_coverage("lab", payload)


def _labs_that_were_refused():
    """The three real labs, reduced to what made each one fail."""
    return {
        "retool-postgres, only a backward reference": _lab(
            prior_week_bridge="In Week 4, students utilized Firebase NoSQL document structures.",
            lesson_plan_alignment="Transitions from the Week 4 Firestore backend to PostgreSQL.",
            student_overview="Moving away from Week 4's NoSQL Firestore, you will use PostgreSQL.",
            submission_checklist=["Are the Firebase environments from Week 4 isolated?"],
        ),
        "retool-firestore via service account": _lab(
            title="Week 5 Lab: Rapid Prototyping with Retool and Cloud Firestore Admin Portal",
            learning_objectives=["Connect Retool to Firestore with a service account key"],
            lecturer_setup="Download the Service Account Key, not the Web Client Config.",
        ),
        # The starter file really does call initializeApp — it is the *Admin*
        # SDK's, which is what made a shared function name look like a browser
        # client.
        "n8n with firebase-admin": _lab(
            title="Week 6: Workflow Automation with n8n (Integrating the Firebase/Retool Stack)",
            environment_profile={"required_packages": ["firebase-admin"]},
            pre_lab_tasks=["Ensure your Firestore rules allow Service Account access."],
            starter_files=[{
                "path": "seed.js",
                "content": "const serviceAccount = require('./credentials.json');\n"
                           "admin.initializeApp({credential: admin.credential.cert(serviceAccount)});",
            }],
        ),
    }


class LabTopicAdviceTests(unittest.TestCase):
    """The advice itself. Wrong advice is cheap now, but not free — it is what a
    maintainer reads in the logs, so it should still point somewhere real."""

    def test_a_backward_reference_is_not_treated_as_usage(self):
        self.assertEqual(lab_topic_gaps(_labs_that_were_refused()["retool-postgres, only a backward reference"]), [])

    def test_a_server_side_lab_is_not_held_to_the_client_sdk(self):
        gaps = lab_topic_gaps(_labs_that_were_refused()["retool-firestore via service account"])
        self.assertNotIn("firebaseconfig", gaps)
        self.assertNotIn("onsnapshot", gaps)

    def test_firestore_rules_counts_as_saying_what_governs_access(self):
        self.assertEqual(lab_topic_gaps(_labs_that_were_refused()["n8n with firebase-admin"]), [])

    def test_a_client_sdk_lab_missing_the_specifics_is_still_flagged(self):
        payload = _lab(
            title="Week 4 Lab: Cloud Backend Integration with Firebase",
            environment_profile={"required_software": ["Firebase CLI"]},
        )

        gaps = lab_topic_gaps(payload)
        self.assertIn("firebaseconfig", gaps)
        self.assertIn("onsnapshot", gaps)
        self.assertIn("rules_version or security rules", gaps)

    def test_the_steps_are_usage_too(self):
        payload = _lab(
            title="Week 6 Lab: A Live Attendance Board",
            procedure_steps=[{
                "step_number": 1,
                "title": "Wire the client to the backend",
                "code_blocks": [{"code": "firebase.initializeApp(config);"}],
            }],
        )

        self.assertIn("onsnapshot", lab_topic_gaps(payload))

    def test_coverage_counts_wherever_it_appears_in_the_lab(self):
        payload = _lab(
            environment_profile={"required_software": ["Firebase CLI"]},
            checkpoints=["Firestore updates arrive live via onSnapshot"],
            troubleshooting=[{"symptom": "Writes rejected", "fix": "Publish the security rules"}],
            starter_files=[{"name": "config.js", "contents": "const firebaseConfig = {};"}],
        )

        self.assertEqual(lab_topic_gaps(payload), [])

    def test_the_word_bolt_is_not_a_reference_to_bolt_new(self):
        self.assertEqual(lab_topic_gaps(_lab(learning_objectives=["Attach the bolt-on module"])), [])

    def test_a_bolt_new_lab_still_gets_the_product_named(self):
        self.assertIn("Bolt.new", lab_topic_gaps(_lab(title="Prototyping with Bolt in one afternoon")))


if __name__ == "__main__":
    unittest.main()
