# Live Audio Level Meter — Design Spec

**Date:** 2026-04-22  
**Feature:** Real-time microphone volume meter on the Live Inference page

---

## Overview

Add a visual audio level meter to `LivePage` that animates in real-time based on microphone input while the user is holding the PTT button. The meter is invisible in all other phases (idle, processing, done).

---

## Architecture

### Web Audio API tap in `useLiveSpeech.js`

When `start()` acquires the mic stream, create an `AudioContext` and connect the stream through an `AnalyserNode`. A `requestAnimationFrame` loop reads the time-domain data every frame, computes RMS amplitude, and writes it to a React state value `audioLevel` (float, 0–1). When `stop()` is called, the animation loop is cancelled and the `AudioContext` is closed.

**New refs:**
- `audioContextRef` — holds the `AudioContext`
- `analyserRef` — holds the `AnalyserNode`
- `rafIdRef` — holds the `requestAnimationFrame` ID for cancellation

**New state:**
- `audioLevel` (number, 0–1) — exposed in the hook's return value; reset to `0` when not recording

**RMS calculation:**
```
rms = sqrt( mean( sample² ) )  over the analyser's time-domain buffer
```
The raw RMS is smoothed with a simple lerp (`prev * 0.8 + rms * 0.2`) to avoid jitter and then clamped to [0, 1].

**Cleanup:** The `useEffect` cleanup already stops the stream; add `audioContext.close()` and `cancelAnimationFrame(rafId)` there too.

---

### `MicLevelMeter` component (`client/src/components/MicLevelMeter.jsx`)

A row of **16 vertical bars** that animate based on `level`.

**Props:**
- `level` (number, 0–1) — current audio level
- `active` (boolean) — whether to show the meter

**Behaviour:**
- Hidden (`opacity-0`, `scale-y-0`) when `!active`; fades in with CSS transition when `active` becomes true
- Each bar `i` has a base height (`minH`) and scales up by `level` modulated by a sine curve so bars in the center react more than edges — gives a natural "dome" shape
- Bar color: green at low levels, transitions toward sky-blue/cyan at high levels (matching the page's existing palette). Done with Tailwind's `bg-sky-400` / `bg-emerald-400` classes split at a threshold
- No JS animation loop in the component — it re-renders naturally as `audioLevel` state updates from the hook (~60fps via `requestAnimationFrame`)

**Layout:** `flex gap-[3px] items-end h-10`, centered below the PTT button.

---

### `LivePage.jsx` integration

- Import `MicLevelMeter`
- Pass `level={liveSpeech.audioLevel}` and `active={liveSpeech.phase === 'recording'}`
- Place the meter directly below the PTT button, before the transcript card

```jsx
<MicLevelMeter level={liveSpeech.audioLevel} active={liveSpeech.phase === 'recording'} />
```

---

## Data Flow

```
Mic stream (getUserMedia)
  └─→ AudioContext source node
        └─→ AnalyserNode
              └─→ rAF loop: getByteTimeDomainData → RMS → setAudioLevel(smoothed)
                                                              └─→ MicLevelMeter re-renders
```

---

## Error Handling

- If `AudioContext` creation fails (e.g., browser blocks it), catch silently and leave `audioLevel` at 0. The mic meter just stays flat — not a breaking failure.
- `AudioContext` must be created inside a user-gesture handler (`start()` is called from `onMouseDown`/`onTouchStart`, so autoplay policy is not an issue).

---

## Files Changed

| File | Change |
|------|--------|
| `client/src/hooks/useLiveSpeech.js` | Add Web Audio tap, RMS loop, `audioLevel` state, cleanup |
| `client/src/components/MicLevelMeter.jsx` | New component — 16-bar animated meter |
| `client/src/pages/LivePage.jsx` | Import meter, add below PTT button |

---

## Out of Scope

- Frequency-domain (FFT) equalizer bars — single RMS level is sufficient and simpler
- Meter during playback (output level) — not requested
- Configurable bar count or color themes
