import argparse
import json
import os
import sys
import traceback

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import torch
from faster_whisper import WhisperModel


def load_model(model_size, precision):
    if torch.cuda.is_available():
        try:
            print(
                f"[live-asr] loading Faster Whisper {model_size} on cuda ({precision})",
                file=sys.stderr,
                flush=True,
            )
            return WhisperModel(model_size, device="cuda", compute_type=precision)
        except RuntimeError as exc:
            if "out of memory" not in str(exc).lower():
                raise
            print("[live-asr] CUDA OOM, falling back to CPU int8", file=sys.stderr, flush=True)
            torch.cuda.empty_cache()

    print(f"[live-asr] loading Faster Whisper {model_size} on cpu (int8)", file=sys.stderr, flush=True)
    return WhisperModel(model_size, device="cpu", compute_type="int8")


def transcribe(model, audio_path, language, beam_size):
    language_arg = None if language == "auto" else language
    initial_prompt = None
    if language_arg == "en":
        initial_prompt = (
            "This is clear English speech. Transcribe exactly what is spoken in English. "
            "Do not translate to another language."
        )

    segments, info = model.transcribe(
        audio=audio_path,
        beam_size=beam_size,
        vad_filter=True,
        vad_parameters={
            "min_silence_duration_ms": 600,
            "speech_pad_ms": 220,
        },
        language=language_arg,
        task="transcribe",
        initial_prompt=initial_prompt,
        condition_on_previous_text=False,
        temperature=0,
    )

    text = "".join(segment.text for segment in segments).strip()
    detected_language = (info.language or language or "en").lower()
    return {
        "text": text,
        "language": detected_language,
        "languageProbability": getattr(info, "language_probability", None),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-size", default="medium")
    parser.add_argument("--precision", default="int8")
    parser.add_argument("--beam-size", type=int, default=5)
    args = parser.parse_args()

    model = load_model(args.model_size, args.precision)
    print("[live-asr] ready", file=sys.stderr, flush=True)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            request_id = request["id"]
            result = transcribe(
                model,
                request["audioPath"],
                request.get("language", "auto"),
                int(request.get("beamSize") or args.beam_size),
            )
            print(
                json.dumps({"id": request_id, "ok": True, **result}, ensure_ascii=False),
                flush=True,
            )
        except Exception:
            request_id = "unknown"
            try:
                request_id = request.get("id", "unknown")
            except Exception:
                pass
            print(
                json.dumps({
                    "id": request_id,
                    "ok": False,
                    "error": traceback.format_exc(),
                }),
                flush=True,
            )


if __name__ == "__main__":
    main()
