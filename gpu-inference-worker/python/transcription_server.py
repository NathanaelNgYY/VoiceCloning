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
import math
import os
import re
import sys


def log(message):
    print(f"[transcription_server] {message}", file=sys.stderr, flush=True)


def build_model(model_size=None):
    from faster_whisper import WhisperModel

    if model_size is None:
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


ARPABET_TO_IPA = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ",
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "EH": "ɛ", "ER": "ɝ",
    "EY": "eɪ", "F": "f", "G": "ɡ", "HH": "h", "IH": "ɪ", "IY": "i",
    "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ",
    "OW": "oʊ", "OY": "ɔɪ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ",
    "T": "t", "TH": "θ", "UH": "ʊ", "UW": "u", "V": "v", "W": "w",
    "Y": "j", "Z": "z", "ZH": "ʒ",
}


def arpabet_to_ipa(arpabet):
    phones = []
    for raw in str(arpabet or "").upper().split():
        phone = re.sub(r"[012]$", "", raw)
        ipa = ARPABET_TO_IPA.get(phone)
        if not ipa:
            raise ValueError(f"unsupported ARPAbet phone: {raw}")
        phones.append(ipa)
    if not phones:
        raise ValueError("empty ARPAbet pronunciation")
    # This model's vocabulary contains whole IPA phones (including diphthongs
    # such as aɪ/eɪ), so retain token boundaries instead of concatenating them.
    return " ".join(phones)


def edit_similarity(expected, observed):
    a = list(str(expected or "").replace(" ", ""))
    b = list(str(observed or "").replace(" ", ""))
    if not a:
        return 0.0
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        current = [i]
        for j, right in enumerate(b, 1):
            current.append(min(
                current[-1] + 1,
                previous[j] + 1,
                previous[j - 1] + (left != right),
            ))
        previous = current
    return max(0.0, 1.0 - previous[-1] / max(len(a), len(b), 1))


def ctc_viterbi_score(log_probs, target_ids, blank_id):
    """Best CTC path score for a fixed phone sequence, normalized by audio frames."""
    import torch

    if not target_ids or log_probs.ndim != 2 or log_probs.shape[0] < 1:
        return float("-inf")
    extended = [blank_id]
    for token in target_ids:
        extended.extend([token, blank_id])
    states = len(extended)
    previous = torch.full((states,), float("-inf"), device=log_probs.device)
    previous[0] = log_probs[0, blank_id]
    if states > 1:
        previous[1] = log_probs[0, extended[1]]
    for frame in range(1, log_probs.shape[0]):
        current = torch.full((states,), float("-inf"), device=log_probs.device)
        for state, token in enumerate(extended):
            choices = [previous[state]]
            if state > 0:
                choices.append(previous[state - 1])
            if state > 1 and token != blank_id and token != extended[state - 2]:
                choices.append(previous[state - 2])
            current[state] = torch.stack(choices).max() + log_probs[frame, token]
        previous = current
    final = previous[-1] if states == 1 else torch.stack([previous[-1], previous[-2]]).max()
    return float(final.item() / max(1, log_probs.shape[0]))


def build_phoneme_verifier():
    import torch
    from transformers import AutoModelForCTC, AutoProcessor

    model_name = os.environ.get("PHONEME_MODEL", "facebook/wav2vec2-lv-60-espeak-cv-ft")
    requested_device = os.environ.get("PHONEME_DEVICE", "auto")
    device = "cuda" if requested_device == "auto" and torch.cuda.is_available() else requested_device
    if device not in ("cpu", "cuda"):
        device = "cpu"
    processor = AutoProcessor.from_pretrained(model_name)
    model = AutoModelForCTC.from_pretrained(model_name)
    try:
        model.to(device)
    except Exception as exc:  # noqa: BLE001 - a busy/incompatible GPU can still use CPU
        if device != "cuda":
            raise
        log(f"failed to load phoneme model on cuda, falling back to cpu: {exc}")
        device = "cpu"
        model.to(device)
    model.eval()
    log(f"loaded phoneme model={model_name} device={device}")
    return {"processor": processor, "model": model, "device": device, "name": model_name}


def verify_phonemes(path, start, end, arpabet, state):
    import torch
    import torchaudio

    if state.get("failed"):
        return {"ok": False, "inconclusive": True, "reason": state.get("error", "phoneme model unavailable")}
    if state.get("verifier") is None:
        try:
            state["verifier"] = build_phoneme_verifier()
        except Exception as exc:  # noqa: BLE001
            state["failed"] = True
            state["error"] = str(exc)
            log(f"phoneme model unavailable: {exc}")
            return {"ok": False, "inconclusive": True, "reason": str(exc)}

    verifier = state["verifier"]
    expected_ipa = arpabet_to_ipa(arpabet)
    waveform, sample_rate = torchaudio.load(path)
    waveform = waveform.mean(dim=0)
    padding = float(os.environ.get("PHONEME_SPAN_PADDING_SEC", "0.06"))
    clip_start = max(0.0, float(start) - padding)
    clip_end = min(waveform.shape[-1] / sample_rate, float(end) + padding)
    if clip_end <= clip_start:
        return {"ok": False, "inconclusive": True, "reason": "invalid phoneme span"}
    waveform = waveform[int(clip_start * sample_rate):math.ceil(clip_end * sample_rate)]
    if sample_rate != 16000:
        waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)

    processor = verifier["processor"]
    model = verifier["model"]
    device = verifier["device"]
    inputs = processor(waveform.numpy(), sampling_rate=16000, return_tensors="pt")
    input_values = inputs.input_values.to(device)
    with torch.no_grad():
        logits = model(input_values).logits[0]
    log_probs = torch.log_softmax(logits.float(), dim=-1)
    predicted_ids = torch.argmax(logits, dim=-1)
    observed_ipa = processor.batch_decode(predicted_ids.unsqueeze(0))[0]

    tokenizer = processor.tokenizer
    # The target is already IPA from the saved ARPAbet entry. Convert the explicit
    # phone tokens directly so the tokenizer cannot run grapheme-to-phoneme over
    # IPA a second time or collapse a diphthong into the wrong symbols.
    target_tokens = expected_ipa.split()
    target_ids = tokenizer.convert_tokens_to_ids(target_tokens)
    unk_id = getattr(tokenizer, "unk_token_id", None)
    if not target_ids or (unk_id is not None and unk_id in target_ids):
        return {
            "ok": False,
            "inconclusive": True,
            "reason": "expected phones are outside phoneme model vocabulary",
            "expected": expected_ipa,
            "observed": observed_ipa,
        }
    blank_id = model.config.pad_token_id
    if blank_id is None:
        blank_id = tokenizer.pad_token_id
    if blank_id is None:
        blank_id = 0
    ctc_score = ctc_viterbi_score(log_probs, target_ids, blank_id)
    similarity = edit_similarity(expected_ipa, observed_ipa)
    min_ctc = float(os.environ.get("PHONEME_MIN_CTC_LOG_PROB", "-3.8"))
    min_similarity = float(os.environ.get("PHONEME_MIN_SIMILARITY", "0.5"))
    ok = ctc_score >= min_ctc and similarity >= min_similarity
    return {
        "ok": ok,
        "inconclusive": False,
        "expected": expected_ipa,
        "observed": observed_ipa,
        "ctcScore": round(ctc_score, 4),
        "similarity": round(similarity, 4),
        "model": verifier["name"],
    }


def main():
    try:
        model = build_model()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ready": False, "error": str(exc)}), flush=True)
        return 1

    language = os.environ.get("TRANSCRIPTION_LANGUAGE", "en") or None
    print(json.dumps({"ready": True}), flush=True)

    # Optional heavier model for requests tagged tier="accurate" (Live Full / Queue).
    # Lazy-loaded on first use so startup and the fast paths pay nothing for it; if it
    # fails to load (VRAM, missing download), requests permanently fall back to the
    # default model instead of erroring.
    accurate_size = os.environ.get("TRANSCRIPTION_MODEL_ACCURATE", "")
    default_size = os.environ.get("TRANSCRIPTION_MODEL", "small")
    accurate_state = {"model": None, "failed": accurate_size in ("", default_size)}
    phoneme_state = {"verifier": None, "failed": False, "error": ""}

    def model_for(tier):
        if tier != "accurate" or accurate_state["failed"]:
            return model
        if accurate_state["model"] is None:
            try:
                accurate_state["model"] = build_model(accurate_size)
            except Exception as exc:  # noqa: BLE001
                log(f"accurate model {accurate_size} unavailable, using default: {exc}")
                accurate_state["failed"] = True
                return model
        return accurate_state["model"]

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
            operation = request.get("operation", "transcribe")
            if operation == "phoneme_verify":
                result = verify_phonemes(
                    path,
                    request.get("start"),
                    request.get("end"),
                    request.get("arpabet"),
                    phoneme_state,
                )
                print(json.dumps({"id": request_id, **result}), flush=True)
                continue
            if operation != "transcribe":
                raise ValueError(f"unsupported operation: {operation}")
            tier = request.get("tier")
            beam_env = "TRANSCRIPTION_BEAM_SIZE_ACCURATE" if tier == "accurate" else "TRANSCRIPTION_BEAM_SIZE"
            beam_default = "5" if tier == "accurate" else "1"
            segments, _info = model_for(tier).transcribe(
                path,
                language=language,
                beam_size=int(os.environ.get(beam_env, beam_default)),
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
