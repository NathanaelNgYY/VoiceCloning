# Word Timestamp Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each word's start time as a small monospace label above it in `WordTimestampPlayer`, with the active word highlighted yellow and its label turning amber as audio plays.

**Architecture:** Single component edit — `WordTimestampPlayer.jsx`. The audio sync logic (`timeupdate`/`ended`/`pause` listeners and `findActiveWordIndex`) is unchanged. Only the JSX rendering of the word list changes: the flat inline-text layout becomes a `flex flex-wrap` row of vertical stacks (timestamp label on top, word below).

**Tech Stack:** React 18, Tailwind CSS, `cn()` utility from `@/lib/utils`

---

### Task 1: Update word rendering in `WordTimestampPlayer`

**Files:**
- Modify: `client/src/components/WordTimestampPlayer.jsx`

Read the current file first so you have the full context before editing.

- [ ] **Step 1: Open the file and locate the word-list container**

  In `client/src/components/WordTimestampPlayer.jsx`, find this block (around line 74):

  ```jsx
  {(hasTimestamps || hasTranscript) && (
    <div className="mb-4 rounded-2xl border border-white/80 bg-white/75 px-4 py-3 text-sm leading-7 text-slate-700 shadow-sm">
      {hasTimestamps ? (
        wordTimestamps.map((item, index) => (
          <React.Fragment key={`${item.word}-${item.start}-${index}`}>
            <span
              className={cn(
                'rounded px-0.5 transition-colors',
                index === activeIndex && 'bg-yellow-200 text-slate-950'
              )}
            >
              {item.word}
            </span>
            {index < wordTimestamps.length - 1 && ' '}
          </React.Fragment>
        ))
      ) : (
        <span className="text-muted-foreground">{transcript}</span>
      )}
    </div>
  )}
  ```

- [ ] **Step 2: Replace that block with the timestamp-label layout**

  Replace the entire block identified in Step 1 with:

  ```jsx
  {(hasTimestamps || hasTranscript) && (
    <div className="mb-4 rounded-2xl border border-white/80 bg-white/75 px-4 py-3 text-sm text-slate-700 shadow-sm">
      {hasTimestamps ? (
        <div className="flex flex-wrap items-end gap-x-1 gap-y-2">
          {wordTimestamps.map((item, index) => (
            <div
              key={`${item.word}-${item.start}-${index}`}
              className="inline-flex flex-col items-center gap-0.5"
            >
              <span
                className={cn(
                  'font-mono text-[9px]',
                  index === activeIndex ? 'text-amber-600' : 'text-slate-400'
                )}
              >
                {item.start.toFixed(2)}
              </span>
              <span
                className={cn(
                  'rounded px-0.5 transition-colors',
                  index === activeIndex && 'bg-yellow-200 text-slate-950'
                )}
              >
                {item.word}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-muted-foreground">{transcript}</span>
      )}
    </div>
  )}
  ```

  Key diffs from the original:
  - `leading-7` removed from the outer `<div>` (the flex layout controls vertical rhythm now)
  - `React.Fragment` + flat `<span>` + space character replaced by a `<div className="inline-flex flex-col ...">` wrapper per word
  - Timestamp `<span>` added above each word: `{item.start.toFixed(2)}`
  - Timestamp colour: `text-amber-600` when active, `text-slate-400` otherwise
  - Word `<span>` highlight logic unchanged: `bg-yellow-200 text-slate-950` when active

- [ ] **Step 3: Start the dev server and verify visually**

  ```bash
  # Terminal 1
  cd server && npm run dev

  # Terminal 2
  cd client && npm run dev
  ```

  Open `http://localhost:5173/tts-test` in the browser.

  1. Select a voice profile and confirm a reference audio (these auto-populate if you have training data).
  2. Type a short sentence in the text box and click **Generate Speech**.
  3. After generation completes, the word display should show:
     - Every word with a small `0.00`-style label above it
     - All labels in slate-grey initially
  4. Press play on the audio element:
     - The active word gets a yellow background
     - Its timestamp label turns amber
     - When the word changes, the highlight moves to the next word
  5. Pause → all highlights clear immediately.

  Also check the fallback: the SSE path (`/inference` page, not TTS Test) renders `inference.wordTimestamps` which may be `null`. When null, `hasTimestamps` is false and the component falls back to rendering `transcript` as plain text — confirm this still works (no crash, just plain text shown).

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/components/WordTimestampPlayer.jsx
  git commit -m "feat: show timestamp labels above words in WordTimestampPlayer"
  ```
