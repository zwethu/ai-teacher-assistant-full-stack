import unittest

from services.agent_gateway import split_stream_chunk


class StreamChunkingTest(unittest.TestCase):
    def test_split_stream_chunk_preserves_exact_text(self) -> None:
        samples = [
            "Short response.",
            "Paragraph one.\n\nParagraph two has more text and a sentence boundary.",
            "A" * 500,
            "First sentence. Second sentence! Third sentence? Then a comma, and more words.",
        ]

        for sample in samples:
            with self.subTest(sample=sample[:24]):
                self.assertEqual("".join(split_stream_chunk(sample, max_chars=40)), sample)


if __name__ == "__main__":
    unittest.main()
