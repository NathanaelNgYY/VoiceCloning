"""Regenerate per-word transcript timings for the GI-bleeding lesson.

Run this only when the lesson video changes. Output is committed, so viewers
never pay for transcription and the page needs no network or GPU to reveal the
transcript in step with playback.

    python scripts/transcript/build_word_timings.py

Pipeline:
  1. pull the lesson audio off CloudFront and encode to mp3 (25 MB API limit)
  2. transcribe with OpenAI whisper-1, word-level timestamps
  3. align those timings onto the CURATED wording in mockCourseData.js
  4. emit client/src/api/giBleedingWordTimings.json

Why whisper-1: it is the only OpenAI model that returns word-level timestamps.
`timestamp_granularities=["word"]` requires it -- the gpt-4o-transcribe family
does not support granular timestamps at all.

Why the curated wording wins: raw ASR drops punctuation and mangles exactly the
terms this lesson turns on ("melena", "ligament of Treitz"). Whisper agrees with
the curated text closely enough (~96% of words match directly) that we can take
its timings and keep the reviewed wording. Unmatched words are interpolated from
their neighbours, so every word has a monotonic timing and the reveal never
stalls.

Requires: ffmpeg on PATH, OPENAI_API_KEY in live-gateway/.env, and
`pip install openai`. Costs roughly $0.07 for an 11-minute video.
"""
import json
import re
import subprocess
import sys
import tempfile
from difflib import SequenceMatcher
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
COURSE = REPO / "client" / "src" / "api" / "mockCourseData.js"
ENV = REPO / "live-gateway" / ".env"
OUT = REPO / "client" / "src" / "api" / "giBleedingWordTimings.json"

VIDEO_URL = "https://d2o0cbe2zunqkr.cloudfront.net/videos/gi-bleeding.mp4"
MAX_UPLOAD_MB = 25

# whisper-1 caps the prompt at 224 tokens, so this is a deliberately short list
# of the terms the lesson turns on rather than a dump of the whole transcript.
PROMPT = (
    "Gastrointestinal bleeding lecture. Terms: upper GI bleeding, lower GI bleeding, "
    "ligament of Treitz, duodenum, jejunum, oesophagus, haematemesis, melaena, "
    "haematochezia, peptic ulcer, variceal bleeding, oesophageal varices, "
    "portal hypertension, Mallory-Weiss tear, angiodysplasia, diverticular bleeding, "
    "Helicobacter pylori, proton pump inhibitor, endoscopy, colonoscopy, haemoglobin, "
    "resuscitation, haemodynamic, Glasgow-Blatchford score, Rockall score, cirrhosis, "
    "octreotide, terlipressin."
)

SEG_RE = re.compile(
    r"\{\s*time:\s*([\d.]+)\s*,\s*endTime:\s*([\d.]+)\s*,\s*title:\s*\"((?:[^\"\\]|\\.)*)\"\s*,"
    r"\s*text:\s*\"((?:[^\"\\]|\\.)*)\"\s*,?\s*\}",
    re.S,
)


def api_key():
    if not ENV.exists():
        sys.exit(f"missing {ENV}")
    for line in ENV.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*OPENAI_API_KEY\s*=\s*(.+)\s*$", line)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    sys.exit("OPENAI_API_KEY not found in live-gateway/.env")


def curated_segments():
    segs = [
        {
            "time": float(m.group(1)),
            "endTime": float(m.group(2)),
            "title": m.group(3),
            "text": m.group(4).encode().decode("unicode_escape"),
        }
        for m in SEG_RE.finditer(COURSE.read_text(encoding="utf-8"))
    ]
    if not segs:
        sys.exit("parsed 0 segments from mockCourseData.js -- has its shape changed?")
    return segs


def fetch_audio(dest):
    """Stream the video off CloudFront, keeping only mono 16k mp3 audio."""
    print(f"extracting audio from {VIDEO_URL}", flush=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", VIDEO_URL,
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k",
         str(dest)],
        check=True,
    )
    size_mb = dest.stat().st_size / 1048576
    print(f"audio: {size_mb:.2f} MB (limit {MAX_UPLOAD_MB})", flush=True)
    if size_mb >= MAX_UPLOAD_MB:
        sys.exit("audio exceeds the endpoint limit -- lower the bitrate")


def transcribe(audio):
    from openai import OpenAI

    print("transcribing (whisper-1, word timestamps)", flush=True)
    with audio.open("rb") as fh:
        result = OpenAI(api_key=api_key()).audio.transcriptions.create(
            file=fh,
            model="whisper-1",
            response_format="verbose_json",
            timestamp_granularities=["word"],
            language="en",
            prompt=PROMPT,
        )
    words = result.model_dump().get("words") or []
    if not words:
        sys.exit("no word timings returned -- check the model and granularity")
    print(f"got {len(words)} words", flush=True)
    return words


def key(token):
    return re.sub(r"[^a-z0-9]", "", token.lower())


def interpolate(entries, seg_start, seg_end):
    """Give every unmatched word a timing between its matched neighbours."""
    n = len(entries)
    for i, e in enumerate(entries):
        if e["start"] is not None:
            continue
        prev = next((entries[j]["end"] for j in range(i - 1, -1, -1)
                     if entries[j]["end"] is not None), seg_start)
        nxt = next((entries[j]["start"] for j in range(i + 1, n)
                    if entries[j]["start"] is not None), seg_end)
        nxt = max(nxt, prev)
        run = [i]
        while run[-1] + 1 < n and entries[run[-1] + 1]["start"] is None:
            run.append(run[-1] + 1)
        step = (nxt - prev) / (len(run) + 1)
        for k, j in enumerate(run, start=1):
            entries[j]["start"] = round(prev + step * (k - 1), 3)
            entries[j]["end"] = round(prev + step * k, 3)


def align(segs, asr):
    out, matched_total, word_total = [], 0, 0
    for seg in segs:
        curated = seg["text"].split()
        window = [w for w in asr if seg["time"] <= w["start"] < seg["endTime"]]
        entries = [{"w": t, "start": None, "end": None} for t in curated]

        a = [key(t) for t in curated]
        b = [key(w["word"]) for w in window]
        for op, i1, i2, j1, _ in SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
            if op != "equal":
                continue
            for off in range(i2 - i1):
                entries[i1 + off]["start"] = window[j1 + off]["start"]
                entries[i1 + off]["end"] = window[j1 + off]["end"]

        matched = sum(1 for e in entries if e["start"] is not None)
        matched_total += matched
        word_total += len(entries)
        interpolate(entries, seg["time"], seg["endTime"])
        out.append({"time": seg["time"], "words": entries})
        print(f"  {seg['time']:>8.2f}  {matched:>3}/{len(entries):<3}  {seg['title'][:40]}")

    print(f"matched {matched_total}/{word_total} curated words "
          f"({100 * matched_total / word_total:.1f}%); rest interpolated")
    return out


def main():
    segs = curated_segments()
    print(f"curated segments: {len(segs)}")

    with tempfile.TemporaryDirectory() as tmp:
        audio = Path(tmp) / "lesson.mp3"
        fetch_audio(audio)
        asr = transcribe(audio)

    aligned = align(segs, asr)

    # A word whose start goes backwards would un-reveal as the video plays.
    flat = [e for s in aligned for e in s["words"]]
    assert all(e["start"] is not None for e in flat), "word left without a timing"
    clamped = 0
    for prev, cur in zip(flat, flat[1:]):
        if cur["start"] < prev["start"]:
            cur["start"] = prev["start"]
            clamped += 1
        cur["end"] = max(cur["end"], cur["start"])
    print(f"clamped {clamped} non-monotonic word starts")

    payload = [
        {"time": s["time"],
         "words": [[e["w"], round(e["start"], 2), round(e["end"], 2)] for e in s["words"]]}
        for s in aligned
    ]
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB, {len(flat)} words)")


if __name__ == "__main__":
    main()
