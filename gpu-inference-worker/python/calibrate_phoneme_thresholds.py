#!/usr/bin/env python3
"""Fit conservative phoneme-verifier pass thresholds from labeled crop evidence.

Input is JSON or JSONL with records containing: label (pass/reject), ctcScore,
similarity, and minPhoneConfidence. This does not manufacture calibration data;
use human-reviewed dev generations and keep a held-out set for final evaluation.
"""
import argparse
import json


def load_records(path):
    text = open(path, encoding="utf-8").read().strip()
    if not text:
        return []
    parsed = json.loads(text) if text.startswith("[") else [json.loads(line) for line in text.splitlines()]
    return [row for row in parsed if str(row.get("label", "")).lower() in ("pass", "reject")]


def candidate_values(records, key):
    return sorted({float(row[key]) for row in records if row.get(key) is not None})


def fit_thresholds(records, max_false_accept_rate=0.02):
    positives = [row for row in records if str(row["label"]).lower() == "pass"]
    negatives = [row for row in records if str(row["label"]).lower() == "reject"]
    if not positives or not negatives:
        raise ValueError("calibration requires both pass and reject labels")

    best = None
    for ctc in candidate_values(records, "ctcScore"):
        for similarity in candidate_values(records, "similarity"):
            for phone_confidence in candidate_values(records, "minPhoneConfidence"):
                accepts = lambda row: (
                    float(row["ctcScore"]) >= ctc
                    and float(row["similarity"]) >= similarity
                    and float(row["minPhoneConfidence"]) >= phone_confidence
                )
                true_accept_rate = sum(accepts(row) for row in positives) / len(positives)
                false_accept_rate = sum(accepts(row) for row in negatives) / len(negatives)
                if false_accept_rate > max_false_accept_rate:
                    continue
                candidate = (true_accept_rate, -false_accept_rate, ctc, similarity, phone_confidence)
                if best is None or candidate > best[0]:
                    best = (candidate, {
                        "sampleCount": len(records),
                        "positiveCount": len(positives),
                        "negativeCount": len(negatives),
                        "trueAcceptRate": round(true_accept_rate, 4),
                        "falseAcceptRate": round(false_accept_rate, 4),
                        "PHONEME_MIN_CTC_LOG_PROB": ctc,
                        "PHONEME_MIN_SIMILARITY": similarity,
                        "PHONEME_MIN_PHONE_CONFIDENCE": phone_confidence,
                    })
    if best is None:
        raise ValueError("no threshold combination satisfies the false-accept constraint")
    return best[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("labels")
    parser.add_argument("--max-false-accept-rate", type=float, default=0.02)
    args = parser.parse_args()
    print(json.dumps(fit_thresholds(load_records(args.labels), args.max_false_accept_rate), indent=2))


if __name__ == "__main__":
    main()
