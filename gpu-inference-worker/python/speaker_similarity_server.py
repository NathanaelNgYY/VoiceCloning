#!/usr/bin/env python3
"""Persistent speaker-similarity sidecar (resemblyzer).

Scores how close a synthesized take is to the reference voice, so the worker can
reject (or de-prioritize) a take that drifted away from the cloned speaker while
chasing a complete read. resemblyzer's speaker-embedding weights ship inside the
pip package, so this needs NO model download — important on a network-isolated GPU
box. The model loads once; requests are JSON lines over stdin/stdout.

Protocol
--------
Startup:   prints ``{"ready": true}`` once the encoder is loaded, else
           ``{"ready": false, "error": "..."}`` and exits non-zero.
Request:   ``{"id": "<str>", "ref": "<wav path>", "take": "<wav path>"}``
Response:  ``{"id": "<str>", "similarity": <float 0..1>}`` or ``{"id", "error"}``.

Reference embeddings are cached by path so the reference clip is only embedded
once across a whole passage.
"""

import json
import os
import sys


def log(message):
    print(f"[speaker_similarity_server] {message}", file=sys.stderr, flush=True)


def main():
    try:
        import numpy as np
        from resemblyzer import VoiceEncoder, preprocess_wav
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ready": False, "error": f"import failed: {exc}"}), flush=True)
        return 1

    device = os.environ.get("SPEAKER_DEVICE", "") or None  # None => resemblyzer auto-picks
    try:
        encoder = VoiceEncoder(device=device)
    except Exception as exc:  # noqa: BLE001
        # Fall back to CPU if a CUDA init fails, so the gate degrades instead of dying.
        try:
            encoder = VoiceEncoder(device="cpu")
        except Exception as exc2:  # noqa: BLE001
            print(json.dumps({"ready": False, "error": f"{exc}; cpu: {exc2}"}), flush=True)
            return 1

    ref_cache = {}

    def embed(path):
        wav = preprocess_wav(path)
        # resemblyzer embeddings are already L2-normalized, so a dot product is cosine.
        return encoder.embed_utterance(wav)

    log("encoder loaded")
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            print(json.dumps({"id": None, "error": f"bad request: {exc}"}), flush=True)
            continue

        request_id = request.get("id")
        ref_path = request.get("ref")
        take_path = request.get("take")
        if not ref_path or not take_path:
            print(json.dumps({"id": request_id, "error": "missing ref/take path"}), flush=True)
            continue

        try:
            if ref_path not in ref_cache:
                ref_cache[ref_path] = embed(ref_path)
            ref_emb = ref_cache[ref_path]
            take_emb = embed(take_path)
            similarity = float(np.dot(ref_emb, take_emb))
            # Clamp to [0, 1]; negative cosines just mean "very dissimilar".
            similarity = max(0.0, min(1.0, similarity))
            print(json.dumps({"id": request_id, "similarity": similarity}), flush=True)
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"id": request_id, "error": str(exc)}), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
