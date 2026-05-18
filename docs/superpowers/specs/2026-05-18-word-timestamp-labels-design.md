# Word Timestamp Labels — Design Spec

**Date:** 2026-05-18
**Status:** Approved

## Summary

Enhance `WordTimestampPlayer` so that each word shows its start time (in seconds, 2 decimal places) as a small monospace label above it. The label is always visible for all words. As audio plays, the currently active word gets a yellow background highlight and an amber-coloured timestamp label. Pausing or reaching the end clears the highlight.

## Scope

Single file change: `client/src/components/WordTimestampPlayer.jsx`

The component is already wired up in `InferencePage.jsx` (`directMode`) and receives `wordTimestamps` from the `synthesize()` API call which parses the `x-word-timestamps` response header. No backend changes needed.

## Visual Design

```
 0.00   0.64   0.94   1.22   1.46   ...
[ The ] morning  air   was  refreshing ...
  ^^^
  active word: yellow background (bg-yellow-200, text-slate-950)
               amber timestamp label (text-amber-600)

inactive words: no background, slate-400 timestamp label
```

Layout per word: `inline-flex flex-col items-center gap-0.5`
- Top: `<span>` — `{item.start.toFixed(2)}` — `font-mono text-[9px]`
- Bottom: `<span>` — `{item.word}` — existing highlight classes

Word container: change from `leading-7` inline text to `flex flex-wrap gap-x-1 gap-y-2 items-end`

## Behaviour

| State | Word background | Timestamp label colour |
|---|---|---|
| Active (playing) | `bg-yellow-200 text-slate-950` | `text-amber-600` |
| Inactive | none | `text-slate-400` |
| Paused / ended | none (all reset to inactive) | `text-slate-400` |

Fallback (no timestamps, transcript only): unchanged — renders plain text as before.

## What Does NOT Change

- Audio sync logic (`timeupdate` / `ended` / `pause` event listeners)
- `showDownload` prop and Download WAV button
- `findActiveWordIndex` in `wordTimestamps.js`
- All usages outside of `directMode` (SSE path passes `inference.wordTimestamps` which may be null — falls back to transcript, unaffected)

## Out of Scope

- Showing end times or duration
- Fading already-spoken words
- Tooltip on hover
- Any backend or API changes
