import unittest

import torch

from calibrate_phoneme_thresholds import fit_thresholds
from transcription_server import classify_phoneme_scores, ctc_viterbi_alignment


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

    def test_low_single_phone_confidence_cannot_pass(self):
        scores = [score("timestamp"), score("timestamp")]
        scores[0]["minPhoneConfidence"] = 0.01
        scores[1]["minPhoneConfidence"] = 0.01
        self.assertEqual(
            classify_phoneme_scores(
                scores, -3.8, 0.5, -5.5, 0.25, min_phone_confidence=0.015
            ),
            "uncertain",
        )


class MonotonicCtcAlignmentTests(unittest.TestCase):
    @staticmethod
    def log_probs(frame_tokens, vocab_size=4, high=8.0):
        logits = torch.full((len(frame_tokens), vocab_size), -high)
        for frame, token in enumerate(frame_tokens):
            logits[frame, token] = high
        return torch.log_softmax(logits, dim=-1)

    def test_ordered_phone_sequence_has_complete_monotonic_alignment(self):
        alignment = ctc_viterbi_alignment(self.log_probs([0, 1, 0, 2, 0]), [1, 2], 0)
        self.assertEqual(alignment["coverage"], 1.0)
        self.assertGreater(alignment["minPhoneConfidence"], 0.99)
        self.assertLess(alignment["phones"][0]["endFrame"], alignment["phones"][1]["startFrame"])

    def test_reversed_acoustics_score_worse_for_expected_order(self):
        ordered = ctc_viterbi_alignment(self.log_probs([0, 1, 0, 2, 0]), [1, 2], 0)
        reversed_audio = ctc_viterbi_alignment(self.log_probs([0, 2, 0, 1, 0]), [1, 2], 0)
        self.assertLess(reversed_audio["score"], ordered["score"])
        self.assertLess(reversed_audio["minPhoneConfidence"], ordered["minPhoneConfidence"])


class ThresholdCalibrationTests(unittest.TestCase):
    def test_fit_thresholds_respects_false_accept_constraint(self):
        result = fit_thresholds([
            {"label": "pass", "ctcScore": -2.5, "similarity": 0.8, "minPhoneConfidence": 0.2},
            {"label": "pass", "ctcScore": -3.0, "similarity": 0.7, "minPhoneConfidence": 0.1},
            {"label": "reject", "ctcScore": -4.0, "similarity": 0.3, "minPhoneConfidence": 0.01},
            {"label": "reject", "ctcScore": -5.0, "similarity": 0.2, "minPhoneConfidence": 0.005},
        ], max_false_accept_rate=0.0)
        self.assertEqual(result["trueAcceptRate"], 1.0)
        self.assertEqual(result["falseAcceptRate"], 0.0)


if __name__ == "__main__":
    unittest.main()
