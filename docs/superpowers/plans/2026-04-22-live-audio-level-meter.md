# Live Audio Level Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real-time microphone volume meter (16 animated vertical bars) to the Live Inference page that reacts to mic input while the PTT button is held.

**Architecture:** The existing mic stream in `useLiveSpeech.js` is tapped into a Web Audio `AnalyserNode`; a `requestAnimationFrame` loop computes smoothed RMS amplitude and writes it to `audioLevel` state. A new `MicLevelMeter` component renders 16 bars scaled to that level with a dome shape. `LivePage` wires them together.

**Tech Stack:** Web Audio API (`AudioContext`, `AnalyserNode`), React 18 state, Tailwind CSS, `requestAnimationFrame`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `client/src/hooks/useLiveSpeech.js` | Modify | Add Web Audio tap, RMS loop, `audioLevel` state |
| `client/src/components/MicLevelMeter.jsx` | Create | 16-bar animated VU meter component |
| `client/src/pages/LivePage.jsx` | Modify | Import + place meter below PTT button |

---

### Task 1: Add Web Audio level tracking to `useLiveSpeech.js`

**Files:**
- Modify: `client/src/hooks/useLiveSpeech.js`

- [ ] **Step 1: Add new refs and state**

In `useLiveSpeech.js`, add these three refs and one state value directly after the existing `accumulatedTextRef` declaration (around line 24):

```js
const audioContextRef = useRef(null);
const analyserRef = useRef(null);
const rafIdRef = useRef(null);
```

Add this state alongside the existing `useState` declarations (e.g. after `const [error, setError] = useState(null)`):

```js
const [audioLevel, setAudioLevel] = useState(0);
```

- [ ] **Step 2: Start the Web Audio tap in `start()`**

In the `start()` function, after `streamRef.current = stream;` (the line that assigns the stream ref, around line 120), add:

```js
// Web Audio tap — drives the level meter
try {
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  audioContextRef.current = audioCtx;
  analyserRef.current = analyser;

  const buffer = new Uint8Array(analyser.frequencyBinCount);
  let prevLevel = 0;

  function tick() {
    rafIdRef.current = requestAnimationFrame(tick);
    analyser.getByteTimeDomainData(buffer);
    let sumSq = 0;
    for (let i = 0; i < buffer.length; i++) {
      const s = (buffer[i] - 128) / 128;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / buffer.length);
    prevLevel = prevLevel * 0.8 + rms * 0.2;
    setAudioLevel(Math.min(1, prevLevel * 5));
  }
  tick();
} catch {
  // non-blocking — meter stays flat if AudioContext is unavailable
}
```

- [ ] **Step 3: Stop the Web Audio tap in `stop()`**

In `stop()`, add this block at the very top of the function body (before the `if (phaseRef.current !== 'recording') return;` guard so that level resets immediately on any stop call — actually add it after the guard):

Add after `if (phaseRef.current !== 'recording') return;`:

```js
if (rafIdRef.current) {
  cancelAnimationFrame(rafIdRef.current);
  rafIdRef.current = null;
}
setAudioLevel(0);
if (audioContextRef.current) {
  audioContextRef.current.close().catch(() => {});
  audioContextRef.current = null;
  analyserRef.current = null;
}
```

- [ ] **Step 4: Clean up in the existing `useEffect` cleanup**

In the `useEffect(() => { return () => { ... }; }, [])` cleanup function (around line 212), add before the closing `};`:

```js
if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
if (audioContextRef.current) {
  audioContextRef.current.close().catch(() => {});
}
```

- [ ] **Step 5: Expose `audioLevel` in the hook's return value**

In the `return { ... }` at the bottom of the hook, add `audioLevel`:

```js
return {
  phase,
  interimTranscript,
  finalTranscript,
  audioSrc,
  error,
  speechApiAvailable,
  audioLevel,      // ← add this
  start,
  stop,
  onAudioEnded,
};
```

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useLiveSpeech.js
git commit -m "feat: add Web Audio level meter tap to useLiveSpeech"
```

---

### Task 2: Create `MicLevelMeter` component

**Files:**
- Create: `client/src/components/MicLevelMeter.jsx`

- [ ] **Step 1: Write the component**

Create `client/src/components/MicLevelMeter.jsx` with the following content:

```jsx
import { cn } from '@/lib/utils';

const BAR_COUNT = 16;

export function MicLevelMeter({ level, active }) {
  return (
    <div
      className={cn(
        'flex items-end gap-[3px] h-10 transition-opacity duration-300',
        active ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
      aria-hidden="true"
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const t = i / (BAR_COUNT - 1);
        const dome = Math.sin(t * Math.PI);
        const minH = 0.06;
        const barH = minH + (1 - minH) * dome * level;
        return (
          <div
            key={i}
            className="w-1.5 rounded-full bg-sky-400 transition-all duration-75"
            style={{ height: `${barH * 100}%` }}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/MicLevelMeter.jsx
git commit -m "feat: add MicLevelMeter component"
```

---

### Task 3: Wire `MicLevelMeter` into `LivePage.jsx`

**Files:**
- Modify: `client/src/pages/LivePage.jsx`

- [ ] **Step 1: Add the import**

At the top of `client/src/pages/LivePage.jsx`, add the import alongside the existing component imports:

```js
import { MicLevelMeter } from '@/components/MicLevelMeter';
```

- [ ] **Step 2: Place the meter below the PTT button**

In the JSX, find the closing `</button>` of the PTT button (around line 173). Directly after it, add:

```jsx
<MicLevelMeter level={liveSpeech.audioLevel} active={liveSpeech.phase === 'recording'} />
```

The `flex flex-col items-center gap-8` wrapper already centers it.

- [ ] **Step 3: Verify in the browser**

Start the dev server:
```bash
cd client && npm run dev
```

1. Navigate to the Live page (`/live`)
2. Hold the PTT button — the 16 bars should appear and animate with your voice
3. Release the button — bars should fade out immediately
4. Speak loudly vs. softly — bars should scale visibly with volume
5. The dome shape should be taller in the middle and shorter at the edges

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/LivePage.jsx
git commit -m "feat: wire MicLevelMeter into LivePage"
```

---

## Self-Review

**Spec coverage:**
- ✅ Web Audio `AnalyserNode` tap on mic stream → Task 1
- ✅ RMS amplitude loop with smoothing (0.8/0.2 lerp) → Task 1 Step 2
- ✅ `audioLevel` state (0–1), exposed from hook → Task 1 Steps 1 + 5
- ✅ Cleanup: cancel rAF + close AudioContext → Task 1 Steps 4
- ✅ 16 bars, dome shape (sine curve), Tailwind styling → Task 2
- ✅ Visible only during recording phase → Task 3
- ✅ Positioned below PTT button → Task 3

**Placeholder scan:** None found.

**Type consistency:** `audioLevel` (number, 0–1) defined in Task 1 Step 1, consumed in Task 2 as `level` prop, passed in Task 3 — consistent throughout.
