import unittest

from transcription_server import classify_phoneme_scores


def score(family, ctc=-3.0, similarity=0.7):
    return {"family": family, "ctcScore": ctc, "similarity": similarity}


class PhonemeCropDecisionTests(unittest.TestCase):
    def test_terminal_pass_requires_timestamp_and_speech_end_evidence(self):
        scores = [score("timestamp"), score("timestamp"), score("speech_end")]
        self.assertEqual(
            classify_phoneme_scores(scores, -3.8, 0.5, -5.5, 0.25, terminal=True),
            "pass",
        )

    def test_terminal_correlated_timestamp_passes_remain_uncertain(self):
        scores = [
            score("timestamp"),
            score("timestamp"),
            score("speech_end", ctc=-4.5, similarity=0.4),
        ]
        self.assertEqual(
            classify_phoneme_scores(scores, -3.8, 0.5, -5.5, 0.25, terminal=True),
            "uncertain",
        )

    def test_terminal_consistent_bad_evidence_rejects(self):
        scores = [
            score("timestamp", ctc=-6.0, similarity=0.1),
            score("speech_end", ctc=-6.2, similarity=0.15),
        ]
        self.assertEqual(
            classify_phoneme_scores(scores, -3.8, 0.5, -5.5, 0.25, terminal=True),
            "reject",
        )


if __name__ == "__main__":
    unittest.main()
