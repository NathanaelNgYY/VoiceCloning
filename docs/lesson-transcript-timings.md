# Lesson transcript word timings

The GI-bleeding lesson transcript reveals itself word by word as the video plays. This describes where those timings come from and how to regenerate them.

**Regenerate only when the lesson video changes.** The output is committed, so viewers never pay for transcription and the page needs no network call or GPU to drive the reveal.

---

## What ships

| File | Role |
|---|---|
| `client/src/api/giBleedingWordTimings.json` | 31 KB, 18 segments, 1290 words as `[word, start, end]` |
| `client/src/api/mockCourseData.js` | Curated wording + titles; joins the timings on by segment `time` |
| `client/src/lib/transcriptReveal.js` | Decides how much of a segment has been spoken |
| `client/src/components/gi/TranscriptText.jsx` | Renders the reveal |
| `scripts/transcript/build_word_timings.py` | Regeneration pipeline |

## Regenerating

```bash
python scripts/transcript/build_word_timings.py
```

Needs `ffmpeg` on PATH, `pip install openai`, and `OPENAI_API_KEY` in `live-gateway/.env`. Takes about a minute and costs roughly **$0.07** for an 11-minute video.

It pulls the audio off CloudFront, transcribes it, aligns the result onto the curated wording, and rewrites the JSON. Nothing else needs touching.

---

## Two decisions worth not re-litigating

### Why `whisper-1` and not `gpt-4o-transcribe`

`whisper-1` is the **only** OpenAI model that returns word-level timestamps. `timestamp_granularities: ["word"]` requires it; the `gpt-4o-transcribe` family does not support granular timestamps at all — despite being newer and generally more accurate on raw text, and despite being what `live-gateway` uses for the student's microphone.

The Realtime API is also the wrong tool here. It streams text as audio arrives, which gives you *liveness* but not **word timings anchored to the media clock** — you would have to infer each word's position from when you happened to feed that chunk. Word-level timing against the video's own clock is the entire requirement.

### Why the curated wording wins over the ASR text

The script keeps the reviewed transcript in `mockCourseData.js` and takes **only the timings** from Whisper.

Raw ASR drops punctuation and mangles exactly the terms this lesson turns on. On the 2026-07-29 run, Whisper produced "Treitz" ×3, "variceal" ×3, "angiodysplasia" and "Mallory" correctly — the `prompt` seeding works — but returned **zero** instances of "melena", which the curated text has.

The two agree closely enough to make this safe: **96.3% of curated words matched an ASR word directly**, and per-segment counts landed within 1–2 (37/38, 88/88, 91/91…). Unmatched words get timings interpolated from their matched neighbours.

---

## Invariants the renderer depends on

- **Word starts are monotonic across the whole transcript.** A start that goes backwards would make a word *un-reveal* mid-playback. The script clamps violations and asserts none survive.
- **Every word has a finite `start` and `end`.** Asserted before writing.
- **Segments are keyed by `time`,** matched against `transcriptSegments[].time`. A segment with no matching entry renders as plain text rather than breaking — which is also what any lesson that has not been through this pass does.

## Rendering notes

Unspoken words stay in the layout at low contrast rather than being hidden. Revealing by insertion would reflow the paragraph on every frame, and the panel scrolls independently — the reader's position would jump. Fading in place gives the same "arriving with the audio" read with a stable box.

`LessonPage` samples the media clock on a `requestAnimationFrame` loop while playing, not on `timeupdate`. `timeupdate` fires ~4×/s, coarser than the ~0.3 s words it drives. State is pushed at ~10 Hz (`REVEAL_RESOLUTION_SECONDS`) because the chat panel is mounted alongside and re-rendering it 60×/s to move one highlight is not worth it.

## Related

- `docs/frontend-deployments.md` — which build serves which CloudFront
- The video is **not** in the repo: `s3://interns2026-small-projects-bucket-shared/gi-bleeding/videos/`, served via `/videos/*`
