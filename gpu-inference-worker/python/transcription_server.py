#!/usr/bin/env python3
"""Persistent faster-whisper transcription sidecar.

Loads the Whisper model ONCE and then serves transcription requests over
stdin/stdout as JSON lines, so the GPU inference worker can verify that each
synthesized chunk actually contains the words it was given (catching the cases
where GPT-SoVITS silently skips or cuts off words). Spawning a fresh python +
reloading the model per chunk would be far too slow for long medical passages,
hence a long-lived process.

Protocol
--------
Startup:   prints a single line ``{"ready": true}`` once the model is loaded
           (or ``{"ready": false, "error": "..."}`` and exits non-zero).
Request:   one JSON object per line on stdin: ``{"id": "<str>", "path": "<wav>"}``
Response:  one JSON object per line on stdout: ``{"id": "<str>", "text": "..."}``
           or ``{"id": "<str>", "error": "..."}``.

All diagnostic output goes to stderr so stdout stays a clean JSON-line channel.
"""

import json
import os
import sys


def log(message):
    print(f"[transcription_server] {message}", file=sys.stderr, flush=True)


def build_model():
    from faster_whisper import WhisperModel

    model_size = os.environ.get("TRANSCRIPTION_MODEL", "small")
    requested_device = os.environ.get("TRANSCRIPTION_DEVICE", "auto")
    compute_type = os.environ.get("TRANSCRIPTION_COMPUTE", "int8")

    # device="auto" picks cuda when available; fall back to cpu if cuda init fails
    # so verification degrades gracefully instead of taking the whole worker down.
    attempts = []
    if requested_device in ("auto", "cuda"):
        attempts.append(("cuda", compute_type))
    attempts.append(("cpu", "int8"))

    last_error = None
    for device, compute in attempts:
        try:
            model = WhisperModel(model_size, device=device, compute_type=compute)
            log(f"loaded model={model_size} device={device} compute={compute}")
            return model
        except Exception as exc:  # noqa: BLE001 - report and try next device
            last_error = exc
            log(f"failed to load on device={device}: {exc}")
    raise last_error if last_error else RuntimeError("could not load Whisper model")


def main():
    try:
        model = build_model()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ready": False, "error": str(exc)}), flush=True)
        return 1

    language = os.environ.get("TRANSCRIPTION_LANGUAGE", "en") or None
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
        path = request.get("path")
        if not path:
            print(json.dumps({"id": request_id, "error": "missing path"}), flush=True)
            continue

        try:
            segments, _info = model.transcribe(
                path,
                language=language,
                beam_size=int(os.environ.get("TRANSCRIPTION_BEAM_SIZE", "1")),
                condition_on_previous_text=False,
                # Per-word timing + probability lets the worker spot a word that
                # Whisper "filled in" from context but the audio only said halfway
                # (low probability and/or an implausibly short span) — the
                # clipped-word case plain coverage can't see.
                word_timestamps=True,
            )
            words = []
            text_parts = []
            for segment in segments:
                text_parts.append(segment.text.strip())
                for word in (segment.words or []):
                    words.append({
                        "w": word.word.strip(),
                        "start": round(float(word.start), 3),
                        "end": round(float(word.end), 3),
                        "p": round(float(word.probability), 4),
                    })
            text = " ".join(text_parts).strip()
            print(json.dumps({"id": request_id, "text": text, "words": words}), flush=True)
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"id": request_id, "error": str(exc)}), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
