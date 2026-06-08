#!/usr/bin/env python3
"""Score voice-reference clips by audio cleanliness / quality.

Given a directory of audio clips, computes per-clip quality metrics and a
combined 0-100 score, then prints a ranked table (+ optional JSON). Used to
auto-pick the cleanest reference clips for GPT-SoVITS inference — v2Pro/v2ProPlus
are very sensitive to reference-audio quality (a noisy/rough reference makes the
clone sound hoarse).

Metrics:
  snr_db       estimated signal-to-noise ratio (higher = cleaner)
  clip_pct     % of samples near full-scale (clipping/distortion; lower = better)
  flatness     mean spectral flatness (1 = noise-like, 0 = clean speech; lower better)
  speech_ratio fraction of frames clearly above the noise floor (more = more usable)
  duration_s   clip length (ideal ~3-9s for a stable speaker embedding)

Usage:
  python score_clips.py <dir> [--json out.json] [--top N]
"""
import argparse
import glob
import json
import os
import sys

import numpy as np

try:
    import librosa
except ImportError:
    print("librosa is required (it ships with GPT-SoVITS). pip install librosa", file=sys.stderr)
    raise

AUDIO_EXTS = (".wav", ".flac", ".mp3", ".m4a", ".ogg")


def analyze(path, target_sr=16000):
    y, sr = librosa.load(path, sr=target_sr, mono=True)
    n = len(y)
    if n < int(target_sr * 0.3):  # < 0.3s is unusable
        return None
    duration = n / sr

    frame, hop = 1024, 512
    rms = librosa.feature.rms(y=y, frame_length=frame, hop_length=hop)[0] + 1e-9
    noise = float(np.percentile(rms, 10))   # quietest frames ~ noise floor
    speech = float(np.percentile(rms, 95))  # loudest frames ~ speech level
    snr_db = 20.0 * np.log10(speech / noise)

    clip_frac = float(np.mean(np.abs(y) > 0.985))
    flatness = float(np.mean(librosa.feature.spectral_flatness(y=y)[0]))
    speech_ratio = float(np.mean(rms > noise * 3.0))

    # Normalize each metric to 0..1, then weight into a 0..100 score.
    snr_s = float(np.clip((snr_db - 10.0) / 30.0, 0, 1))     # 10dB->0, 40dB->1
    clip_s = float(np.clip(1.0 - clip_frac * 50.0, 0, 1))    # any real clipping tanks it
    flat_s = float(np.clip(1.0 - flatness * 4.0, 0, 1))      # noisy spectrum penalized
    speech_s = float(np.clip((speech_ratio - 0.3) / 0.5, 0, 1))
    if duration < 2:
        dur_s = 0.1
    elif duration < 3:
        dur_s = 0.6
    elif duration <= 9:
        dur_s = 1.0
    elif duration <= 12:
        dur_s = 0.7
    else:
        dur_s = 0.4

    score = 100.0 * (0.40 * snr_s + 0.15 * clip_s + 0.20 * flat_s
                     + 0.10 * speech_s + 0.15 * dur_s)
    return {
        "file": os.path.basename(path),
        "score": round(score, 1),
        "snr_db": round(snr_db, 1),
        "clip_pct": round(clip_frac * 100.0, 3),
        "flatness": round(flatness, 3),
        "speech_ratio": round(speech_ratio, 2),
        "duration_s": round(duration, 1),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("directory")
    ap.add_argument("--json", default="")
    ap.add_argument("--top", type=int, default=10)
    args = ap.parse_args()

    files = []
    for ext in AUDIO_EXTS:
        files += glob.glob(os.path.join(args.directory, "*" + ext))
    files = sorted(set(files))
    if not files:
        print("No audio files found in", args.directory, file=sys.stderr)
        sys.exit(1)

    results = []
    for f in files:
        try:
            r = analyze(f)
            if r:
                results.append(r)
        except Exception as exc:  # noqa: BLE001
            print("skip", os.path.basename(f), "-", exc, file=sys.stderr)

    results.sort(key=lambda r: r["score"], reverse=True)

    print("\n%5s  %5s  %6s  %5s  %4s  %4s  file" % ("score", "snr", "clip%", "flat", "spch", "dur"))
    print("-" * 88)
    for r in results[: args.top]:
        print("%5s  %5s  %6s  %5s  %4s  %4s  %s" % (
            r["score"], r["snr_db"], r["clip_pct"], r["flatness"],
            r["speech_ratio"], r["duration_s"], r["file"]))
    print("\n%d clips scored. Top %d shown." % (len(results), min(args.top, len(results))))
    print("BEST 5:")
    for r in results[:5]:
        print("  -", r["file"])

    if args.json:
        with open(args.json, "w") as fh:
            json.dump({r["file"]: r for r in results}, fh, indent=2)
        print("wrote", args.json)


if __name__ == "__main__":
    main()
