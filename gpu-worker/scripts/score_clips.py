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
  silence_ratio / max_silence_s / peak_dbfs / dc_offset
               detect dead air, weak recordings, and biased/corrupt waveforms
  consistency  MFCC similarity to the dataset median (a conservative style/
               channel outlier signal, not a speaker-identity guarantee)

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
    peak = float(np.max(np.abs(y)))
    peak_dbfs = 20.0 * np.log10(max(peak, 1e-9))
    rms_dbfs = 20.0 * np.log10(max(float(np.sqrt(np.mean(y * y))), 1e-9))
    dc_offset = float(abs(np.mean(y)))

    # A relative threshold follows quiet speakers while the absolute floor keeps
    # digital noise from counting as speech. Contiguous silence matters more than
    # total silence: a clean pause is fine, a 2-second dead region is not.
    silence_threshold = max(0.0025, speech * 0.08)
    silent_frames = rms < silence_threshold
    silence_ratio = float(np.mean(silent_frames))
    longest_silent_run = 0
    current_silent_run = 0
    for is_silent in silent_frames:
        current_silent_run = current_silent_run + 1 if is_silent else 0
        longest_silent_run = max(longest_silent_run, current_silent_run)
    max_silence_s = longest_silent_run * hop / sr

    # Retained only until the dataset-level pass below computes similarity to
    # the median clip. MFCC means are a channel/style outlier proxy; they are not
    # treated as proof that the speaker is the same person.
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)
    embedding = np.mean(mfcc, axis=1).astype(float)

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

    silence_s = float(np.clip(1.0 - max(0.0, silence_ratio - 0.35) / 0.45, 0, 1))
    level_s = float(np.clip((peak_dbfs + 30.0) / 18.0, 0, 1))
    dc_s = float(np.clip(1.0 - dc_offset / 0.03, 0, 1))
    score = 100.0 * (
        0.30 * snr_s + 0.12 * clip_s + 0.14 * flat_s
        + 0.10 * speech_s + 0.12 * dur_s + 0.08 * silence_s
        + 0.08 * level_s + 0.06 * dc_s
    )
    return {
        "file": os.path.basename(path),
        "score": round(score, 1),
        "snr_db": round(snr_db, 1),
        "clip_pct": round(clip_frac * 100.0, 3),
        "flatness": round(flatness, 3),
        "speech_ratio": round(speech_ratio, 2),
        "duration_s": round(duration, 1),
        "silence_ratio": round(silence_ratio, 3),
        "max_silence_s": round(max_silence_s, 2),
        "peak_dbfs": round(float(peak_dbfs), 1),
        "rms_dbfs": round(float(rms_dbfs), 1),
        "dc_offset": round(dc_offset, 5),
        "_embedding": embedding.tolist(),
    }


def finalize_dataset_metrics(results):
    if not results:
        return results

    embeddings = np.asarray([row.pop("_embedding") for row in results], dtype=float)
    median = np.median(embeddings, axis=0)
    median_norm = max(float(np.linalg.norm(median)), 1e-9)
    use_consistency_gate = len(results) >= 8

    for row, embedding in zip(results, embeddings):
        denom = max(float(np.linalg.norm(embedding)) * median_norm, 1e-9)
        consistency = float(np.dot(embedding, median) / denom)
        row["consistency"] = round(consistency, 3)

        reasons = []
        if row["duration_s"] < 1.5:
            reasons.append("duration_below_1.5s")
        if row["duration_s"] > 14.0:
            reasons.append("duration_above_14s")
        if row["snr_db"] < 10.0:
            reasons.append("snr_below_10db")
        if row["clip_pct"] > 0.1:
            reasons.append("clipping_above_0.1pct")
        if row["flatness"] > 0.25:
            reasons.append("noise_like_spectrum")
        if row["speech_ratio"] < 0.2:
            reasons.append("too_little_speech")
        if row["speech_ratio"] > 0.98:
            reasons.append("no_breathing_room")
        if row["max_silence_s"] > 1.5:
            reasons.append("long_internal_silence")
        if row["peak_dbfs"] < -30.0:
            reasons.append("recording_too_quiet")
        if row["dc_offset"] > 0.03:
            reasons.append("dc_offset")
        if use_consistency_gate and consistency < 0.55:
            reasons.append("dataset_acoustic_outlier")

        # Consistency has a deliberately small influence. It helps order clean
        # candidates without letting MFCC/content differences overpower SNR and
        # distortion evidence.
        row["score"] = round(float(np.clip(row["score"] + (consistency - 0.7) * 12.0, 0, 100)), 1)
        row["eligible"] = not reasons
        row["rejection_reasons"] = reasons

    return results


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

    finalize_dataset_metrics(results)
    results.sort(key=lambda r: (r["eligible"], r["score"]), reverse=True)

    print("\n%5s  %5s  %6s  %5s  %4s  %4s  file" % ("score", "snr", "clip%", "flat", "spch", "dur"))
    print("-" * 88)
    for r in results[: args.top]:
        print("%5s  %5s  %6s  %5s  %4s  %4s  %s%s" % (
            r["score"], r["snr_db"], r["clip_pct"], r["flatness"],
            r["speech_ratio"], r["duration_s"], r["file"],
            "" if r["eligible"] else "  REJECT=" + ",".join(r["rejection_reasons"])))
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
