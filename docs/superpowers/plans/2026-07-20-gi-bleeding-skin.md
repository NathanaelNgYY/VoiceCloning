# GI-Bleeding Skin (`gi` Build Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `gi` client build mode that renders the gi-bleeding chat interface on top of the existing GPT-SoVITS live-chat engine, without removing or altering any existing feature.

**Architecture:** `GiChatPage` is a container owning only layout state. It gets all engine behaviour from a new `useGiChatEngine` hook, which assembles the kiosk-path inputs for the existing, unmodified `useLiveSpeech`. Presentational components ported from gi-bleeding live in `components/gi/` and are pure and prop-driven.

**Tech Stack:** React 18, Vite 5, Tailwind CSS 3, react-router-dom 6, lucide-react, `node:test`. **No new npm dependencies.**

## Global Constraints

- **Do not modify** `pages/LivePage.jsx`, `pages/TrainingPage.jsx`, `pages/InferencePage.jsx`, `hooks/useLiveSpeech.js`, `hooks/liveConversation.js`, or `services/api.js`. Additive changes only, in the files listed per task.
- **No new npm dependencies.** No React 19, no Tailwind 4, no `livekit-client`, no react-router 7.
- Target **Tailwind CSS 3** syntax. `backdrop-blur-xs` does not exist (use `backdrop-blur-sm`); `@theme` blocks do not exist (use `tailwind.config.js`).
- Tests use **`node:test`** (`import test from 'node:test'; import assert from 'node:assert/strict';`) run via `node --test`. **Not Vitest**, despite what `CLAUDE.md` says.
- All packages are **ES modules**. Use `import`/`export`, never `require`.
- Message objects from the engine use the field **`text`**, not `content`. Fields available: `id`, `role`, `text`, `status`, `error`, `audioUrl`, `audioParts`.
- Client path alias `@/` maps to `client/src/`.
- The gi brand primary is `#181c62` (PANTONE 2758) → HSL triplet **`237 61% 24%`**. Scope it to `.gi-root`, never `:root`.
- All work happens in `client/`. Run commands from `C:\Internship\Webapp VoiceCloning\client`.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/components/gi/ChatMessage.jsx` | One chat bubble. Pure. |
| `src/components/gi/TypingIndicator.jsx` | Three-dot "thinking" bubble. Pure. |
| `src/components/gi/ChatList.jsx` | Message list + autoscroll. Pure. |
| `src/components/gi/ChatHistory.jsx` | Sidebar header + New Chat button. Pure. |
| `src/components/gi/Composer.jsx` | Mic/mute/send controls. Pure. |
| `src/components/gi/AvatarOrb.jsx` | Portrait + pulse rings. Pure. |
| `src/components/gi/AvatarStage.jsx` | Frame around the orb. Pure. |
| `src/components/gi/DisclaimerBanner.jsx` | Dismissible banner. Pure. |
| `src/components/gi/VoicePicker.jsx` | Cloned-voice `<select>`. Pure. |
| `src/hooks/giChatStatus.js` | Pure mapping helpers (`phase` → status/busy/mute). Unit-tested. |
| `src/hooks/giChatStatus.test.js` | Tests for the above. |
| `src/hooks/useGiChatEngine.js` | Engine adapter over `useLiveSpeech`. |
| `src/pages/GiChatPage.jsx` | Layout container. |
| `src/assets/maleavatar.png` | Avatar portrait. |
| `.env.gi` | `VITE_APP_MODE=gi` |

**Modify:** `src/lib/appMode.js`, `src/lib/appMode.test.js`, `src/App.jsx`, `tailwind.config.js`, `src/globals.css`, `package.json`.

Mapping helpers are split into `giChatStatus.js` (separate from `useGiChatEngine.js`) so they can be unit-tested without mounting React — the hook itself is verified manually.

---

### Task 1: `gi` app mode and route

**Files:**
- Modify: `client/src/lib/appMode.js`
- Modify: `client/src/lib/appMode.test.js`
- Modify: `client/src/App.jsx:~200-230` (the `<Route path="/">` element)

**Interfaces:**
- Consumes: nothing.
- Produces: `getAppModeConfig('gi')` returning an object with `showGiChat: true`; every other mode returns `showGiChat: false`.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/lib/appMode.test.js`:

```javascript
test('normalizeAppMode resolves the gi mode', () => {
  assert.equal(normalizeAppMode('gi'), 'gi');
  assert.equal(normalizeAppMode('GI'), 'gi');
  assert.equal(normalizeAppMode('gi-bleeding'), 'gi');
});

test('getAppModeConfig exposes only the gi chat in gi mode', () => {
  const config = getAppModeConfig('gi');

  assert.equal(config.kiosk, true);
  assert.equal(config.showGiChat, true);
  assert.equal(config.showTraining, false);
  assert.equal(config.showLiveFast, false);
  assert.equal(config.showTextToSpeech, false);
  assert.equal(config.defaultPath, '/');
  assert.equal(config.subtitle, 'GI Bleeding Chatbot');
  assert.deepEqual(config.navItems, []);
});

test('getAppModeConfig leaves showGiChat false in every other mode', () => {
  for (const mode of ['combined', 'training', 'live-fast', 'chatbot']) {
    assert.equal(getAppModeConfig(mode).showGiChat, false, `${mode} must not show gi chat`);
  }
});

test('getAppModeConfig keeps chatbot mode unchanged after adding gi', () => {
  const config = getAppModeConfig('chatbot');
  assert.equal(config.kiosk, true);
  assert.equal(config.showLiveFast, true);
  assert.equal(config.subtitle, 'Live Fast Chatbot');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/lib/appMode.test.js`
Expected: FAIL — `normalizeAppMode('gi')` returns `'combined'`, and `config.showGiChat` is `undefined`.

- [ ] **Step 3: Implement the mode**

In `client/src/lib/appMode.js`, replace the top three functions with:

```javascript
const APP_MODES = new Set(['combined', 'training', 'live-fast', 'chatbot', 'gi']);

export function normalizeAppMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'livefast' || normalized === 'live') return 'live-fast';
  if (normalized === 'train') return 'training';
  if (normalized === 'dean' || normalized === 'kiosk') return 'chatbot';
  if (normalized === 'gi-bleeding' || normalized === 'gibleeding') return 'gi';
  return APP_MODES.has(normalized) ? normalized : 'combined';
}

export function getAppModeConfig(value) {
  const mode = normalizeAppMode(value);
  const gi = mode === 'gi';
  const kiosk = mode === 'chatbot' || gi;
  const showTraining = mode === 'combined' || mode === 'training';
  const showLiveFast = mode === 'combined' || mode === 'live-fast' || mode === 'chatbot';
  const showTextToSpeech = mode === 'combined' || mode === 'live-fast';
  const navItems = [];

  if (!kiosk) {
    if (showTraining) {
      navItems.push({ label: 'Training', to: '/', end: true });
    }

    if (showLiveFast) {
      navItems.push({ label: 'Live Fast', to: showTraining ? '/live-fast' : '/', end: !showTraining });
    }

    if (showTextToSpeech) {
      navItems.push({ label: 'Text to Speech', to: showTraining ? '/text-to-speech' : '/?tab=text-to-speech', end: true });
    }
  }

  return {
    mode,
    kiosk,
    gi,
    defaultLiveEngine: 'fast',
    showTraining,
    showLiveFast,
    showTextToSpeech,
    showGiChat: gi,
    navItems,
    defaultPath: '/',
    subtitle: gi
      ? 'GI Bleeding Chatbot'
      : showTraining && showLiveFast
        ? 'GPT-SoVITS Training & Live Fast'
        : showTraining
          ? 'GPT-SoVITS Training'
          : 'Live Fast Chatbot',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/lib/appMode.test.js`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 5: Wire the route, gi branch FIRST**

In `client/src/App.jsx`, add the import next to the existing page imports:

```javascript
import GiChatPage from './pages/GiChatPage.jsx';
```

Replace the `<Route path="/" …>` element. The `showGiChat` check **must come first** — `gi` mode sets `showTraining` and `showLiveFast` false and `defaultPath` to `/`, so falling through to `<Navigate to="/">` would redirect the route to itself forever:

```jsx
            <Route
              path="/"
              element={
                appConfig.showGiChat
                  ? <GiChatPage />
                  : appConfig.showTraining
                    ? <TrainingPage />
                    : appConfig.showLiveFast
                      ? <LiveFastEntry />
                      : <Navigate to={appConfig.defaultPath} replace />
              }
            />
```

Then make the gi page full-bleed. `GiChatPage` is `h-screen` and renders its own header, so it must not sit inside the app shell's `max-w-6xl` main or below the nav header. Replace the `<header>` and `<main>` wrappers in `AppShell` so both are skipped in gi mode. Change the header opening tag to:

```jsx
        {!appConfig.showGiChat && (
        <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md">
```

and close it after the accent-line `div` with `)}`. Then change the `<main>` element to:

```jsx
        <main className={cn(
          'flex w-full flex-1 flex-col',
          appConfig.showGiChat ? 'min-h-0' : 'mx-auto max-w-6xl px-4 py-4 sm:px-8 sm:py-8'
        )}>
```

and wrap the `<footer>` the same way as the header:

```jsx
        {!appConfig.showGiChat && (
        <footer className="mx-auto w-full max-w-6xl border-t border-slate-100 px-4 sm:px-8">
```

closing with `)}` after `</footer>`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/appMode.js src/lib/appMode.test.js src/App.jsx
git commit -m "feat: add gi app mode and full-bleed route"
```

---

### Task 2: Tailwind tokens and gi palette

**Files:**
- Modify: `client/tailwind.config.js`
- Modify: `client/src/globals.css`

**Interfaces:**
- Consumes: nothing.
- Produces: utility classes `bg-surface`, `text-ink`, `text-ink-muted`, `bg-primary-soft`, `animate-pulse-ring`, `animate-pulse-ring-fast`; and a `.gi-root` class that rebinds `--primary` to the gi navy.

- [ ] **Step 1: Add the colours**

In `client/tailwind.config.js`, inside `theme.extend.colors`, add these three entries after the existing `success` entry (keep everything else untouched):

```javascript
        surface: "hsl(var(--gi-surface, 210 40% 98%))",
        ink: "hsl(var(--gi-ink, 215 25% 27%))",
        "ink-muted": "hsl(var(--gi-ink-muted, 215 16% 47%))",
```

and add `soft` to the existing `primary` object so it reads:

```javascript
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          soft: "hsl(var(--primary-soft, 234 46% 94%))",
        },
```

- [ ] **Step 2: Add the pulse-ring animation**

In the same file, add to `theme.extend.keyframes` (after `orb-float`):

```javascript
        "pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.5" },
          "100%": { transform: "scale(1.7)", opacity: "0" },
        },
```

and to `theme.extend.animation` (after `orb-float-3`):

```javascript
        "pulse-ring": "pulse-ring 1.6s ease-out infinite",
        "pulse-ring-fast": "pulse-ring 0.8s ease-out infinite",
```

- [ ] **Step 3: Scope the gi palette**

Append to `client/src/globals.css`:

```css
/* GI-Bleeding skin palette — PANTONE 2758 navy.
   Scoped to the gi page root so other build modes keep the default blue. */
.gi-root {
  --primary: 237 61% 24%;
  --primary-foreground: 0 0% 100%;
  --primary-soft: 234 46% 94%;
  --ring: 237 61% 24%;
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds, no "unknown utility" errors.

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.js src/globals.css
git commit -m "feat: add gi surface/ink tokens and pulse-ring animation"
```

---

### Task 3: Port the presentational components

**Files:**
- Create: `client/src/components/gi/ChatMessage.jsx`, `TypingIndicator.jsx`, `ChatList.jsx`, `ChatHistory.jsx`, `Composer.jsx`, `AvatarOrb.jsx`, `AvatarStage.jsx`, `DisclaimerBanner.jsx`, `VoicePicker.jsx`
- Create: `client/src/assets/maleavatar.png`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils` (this project's helper — the gi source used `@/lib/cn`, which does not exist here); Tailwind classes from Task 2.
- Produces, for Task 6:
  - `<ChatMessage message />` where `message` is `{ id, role, text, status, error }`
  - `<ChatList messages status scrollKey />`
  - `<ChatHistory onNewChat />`
  - `<Composer disabled active loading micMuted inputMode onStart onStop onToggleMute onSend />`
  - `<AvatarStage status fullScreen />`
  - `<AvatarOrb status docked />`
  - `<DisclaimerBanner />`
  - `<VoicePicker disabled options value onChange />` where `options` is `[{ id, label }]`

- [ ] **Step 1: Copy the avatar asset**

```bash
cp "C:/Users/natha/AppData/Local/Temp/claude/C--Internship-Webapp-VoiceCloning/c961eef6-59b7-42e0-ba52-9f7ec1990ffd/scratchpad/gi-bleeding/src/assets/maleavatar.png" src/assets/maleavatar.png
```

If the scratchpad clone is gone, re-clone first:
`git clone --depth 1 https://github.com/jiasshengg/gi-bleeding <tmp>`

- [ ] **Step 2: Create `src/components/gi/ChatMessage.jsx`**

Adapted from gi-bleeding: `message.content` → `message.text`, `message.pending` → `message.status`, `message.sources` dropped (this engine has no RAG sources), `message.error` added (this engine surfaces per-message errors).

```jsx
import { cn } from '@/lib/utils';

const BUSY_STATUSES = ['thinking', 'generating_voice', 'transcribing', 'listening'];

export function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  const isBusy = BUSY_STATUSES.includes(message.status);
  const isEmpty = !message.text;

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed sm:text-sm',
          isUser
            ? 'bg-primary text-white'
            : 'border border-slate-200 bg-white text-ink shadow-sm'
        )}
      >
        {isBusy && isEmpty ? (
          <span className="flex items-center gap-1 py-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  'size-1.5 animate-bounce rounded-full',
                  isUser ? 'bg-white/80' : 'bg-slate-400'
                )}
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        )}

        {message.error && (
          <p className={cn('mt-1.5 text-[10px] sm:text-[11px]', isUser ? 'text-white/80' : 'text-red-600')}>
            {message.error}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/gi/TypingIndicator.jsx`**

```jsx
export function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-slate-400"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/gi/ChatList.jsx`**

```jsx
import { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage.jsx';
import { TypingIndicator } from './TypingIndicator.jsx';

export function ChatList({ messages, status, scrollKey = '' }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, status, scrollKey]);

  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      {status === 'thinking' && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 5: Create `src/components/gi/ChatHistory.jsx`**

Per design decision D3 there is no conversation list, so the source's `conversations`/`activeId`/`onSelect`/`onDelete` props and the per-row overflow menu are removed. What remains is the branded header, the New Chat action, and an empty-history note.

```jsx
import { SquarePen } from 'lucide-react';

export function ChatHistory({ onNewChat }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <h1 className="px-1 pr-10 text-sm font-semibold text-primary">GI Bleeding</h1>

      <button
        type="button"
        onClick={onNewChat}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-primary transition hover:bg-slate-100"
      >
        <SquarePen className="size-4" />
        New Chat
      </button>

      <p className="px-1 text-xs font-medium uppercase tracking-wide text-ink-muted">History</p>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        <p className="px-1 text-xs text-ink-muted">
          This session only — conversations are not saved.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `src/components/gi/AvatarOrb.jsx`**

The source's `color-mix(in oklch, var(--color-primary) 35%, transparent)` inline styles become plain Tailwind 3 opacity utilities.

```jsx
import { cn } from '@/lib/utils';
import defaultAvatar from '@/assets/maleavatar.png';

export function AvatarOrb({ status, docked = false }) {
  const ring =
    status === 'speaking' || status === 'listening'
      ? 'animate-pulse-ring-fast'
      : status === 'connecting' || status === 'thinking' || status === 'transcribing'
        ? 'animate-pulse-ring'
        : null;

  return (
    <div className={cn('relative', docked ? 'size-10' : 'size-28 sm:size-32')}>
      {ring && (
        <>
          <span className={cn('absolute inset-0 rounded-full bg-primary/35', ring)} />
          <span className={cn('absolute inset-0 rounded-full bg-primary/20 [animation-delay:0.4s]', ring)} />
        </>
      )}
      <div
        className={cn(
          'relative h-full w-full overflow-hidden rounded-full shadow-lg transition-all',
          status === 'error' && 'ring-4 ring-red-400',
          status === 'listening' && 'ring-4 ring-rose-400'
        )}
      >
        <img src={defaultAvatar} alt="Chatbot avatar" className="h-full w-full object-cover" />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create `src/components/gi/AvatarStage.jsx`**

The `videoStream` branch is unreachable without LiveKit (design non-goal), so it is removed rather than left dead.

```jsx
import { cn } from '@/lib/utils';
import { AvatarOrb } from './AvatarOrb.jsx';

export function AvatarStage({ status, compact = false, fullScreen = false }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden bg-gradient-to-b from-[#eef0fa] to-slate-100 transition-all',
        fullScreen
          ? 'h-full w-full rounded-none border-0 shadow-none'
          : 'w-full rounded-2xl border border-slate-200 shadow-sm',
        compact ? 'aspect-[5/2] sm:aspect-[3/1]' : !fullScreen && 'aspect-[4/3]'
      )}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <AvatarOrb status={status} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Create `src/components/gi/DisclaimerBanner.jsx`**

```jsx
import { useState } from 'react';
import { X } from 'lucide-react';

const STORAGE_KEY = 'gi-disclaimer-dismissed';

function readDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function DisclaimerBanner() {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // Private-browsing / blocked storage: dismiss for this session only.
    }
    setDismissed(true);
  };

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
      <p>This chatbot provides educational information about GI bleeding only.</p>
      <button
        type="button"
        aria-label="Dismiss disclaimer"
        className="shrink-0 rounded p-0.5 hover:bg-amber-100"
        onClick={handleDismiss}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 9: Create `src/components/gi/VoicePicker.jsx`**

```jsx
export function VoicePicker({ disabled = false, options, value, onChange }) {
  if (!options || options.length === 0) {
    return null;
  }

  const selectedValue = options.some((option) => option.id === value)
    ? value
    : options[0]?.id ?? '';

  return (
    <label className="flex items-center justify-center gap-2 text-xs text-ink-muted">
      <span className="font-medium text-ink">Voice</span>
      <select
        value={selectedValue}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-40 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-ink shadow-sm transition focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 10: Create `src/components/gi/Composer.jsx`**

Copied from the source with two changes: the `locked`/intro-lock prop is dropped (no intro sequence in this engine), and `MAX_CONTEXT_MESSAGE_LENGTH` is inlined as a local constant since `lib/conversationContext.js` is not being ported.

```jsx
import { useRef, useState } from 'react';
import { Loader2, Mic, MicOff, PhoneOff, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

const MAX_MESSAGE_LENGTH = 4000;
const CHARACTER_COUNTER_THRESHOLD = 3500;

export function Composer({
  disabled,
  active,
  loading = false,
  onStart,
  onStop,
  micMuted = false,
  onToggleMute,
  inputMode = 'voice',
  onSend,
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend?.(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleTextChange = (event) => {
    setText(event.target.value);
    const el = event.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  if (inputMode === 'text') {
    const showCharacterCounter = text.length >= CHARACTER_COUNTER_THRESHOLD;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Type your question…"
            rows={1}
            className="min-w-0 flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleSend}
            disabled={disabled || !text.trim()}
            aria-label="Send message"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/25 transition hover:opacity-90 disabled:opacity-50"
          >
            <Send className="size-4" />
          </button>
        </div>
        {showCharacterCounter && (
          <p className="pr-14 text-right text-[11px] text-ink-muted" aria-live="polite">
            {text.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
          </p>
        )}
      </div>
    );
  }

  const label = loading
    ? 'Connecting to voice assistant'
    : active
      ? 'End voice conversation'
      : 'Start voice conversation';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={label}
          aria-busy={loading}
          onClick={active ? onStop : onStart}
          disabled={loading || (disabled && !active)}
          className={cn(
            'inline-flex size-16 items-center justify-center rounded-full transition disabled:opacity-50',
            active
              ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25 hover:bg-rose-600'
              : 'bg-primary text-white shadow-lg shadow-primary/25 hover:opacity-90'
          )}
        >
          {loading ? (
            <Loader2 className="size-6 animate-spin" />
          ) : active ? (
            <PhoneOff className="size-5" />
          ) : (
            <Mic className="size-6" />
          )}
        </button>

        {active && (
          <button
            type="button"
            aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
            onClick={onToggleMute}
            className={cn(
              'inline-flex size-10 items-center justify-center rounded-full border transition',
              micMuted
                ? 'border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            )}
          >
            {micMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>
        )}
      </div>

      {loading && <span className="text-xs text-ink-muted">Connecting…</span>}
    </div>
  );
}
```

- [ ] **Step 11: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds. (Nothing imports these components yet — this only proves they parse and their imports resolve.)

- [ ] **Step 12: Commit**

```bash
git add src/components/gi src/assets/maleavatar.png
git commit -m "feat: port gi-bleeding presentational components"
```

---

### Task 4: Status mapping helpers

**Files:**
- Create: `client/src/hooks/giChatStatus.js`
- Create: `client/src/hooks/giChatStatus.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces, for Task 5: `toGiStatus(phase)`, `isResponseBusy(phase)`, `isVoiceActive(phase)`, `toVoiceOptions(profiles)`.

`useLiveSpeech` reports `phase` as one of `idle`, `listening`, `thinking`, `generating_voice`, `speaking`. The gi components expect `status` as one of `idle`, `connecting`, `listening`, `thinking`, `speaking`, `error`.

- [ ] **Step 1: Write the failing tests**

Create `client/src/hooks/giChatStatus.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isResponseBusy,
  isVoiceActive,
  toGiStatus,
  toVoiceOptions,
} from './giChatStatus.js';

test('toGiStatus passes through the statuses the components already know', () => {
  assert.equal(toGiStatus('idle'), 'idle');
  assert.equal(toGiStatus('listening'), 'listening');
  assert.equal(toGiStatus('thinking'), 'thinking');
  assert.equal(toGiStatus('speaking'), 'speaking');
});

test('toGiStatus maps voice generation onto thinking', () => {
  assert.equal(toGiStatus('generating_voice'), 'thinking');
});

test('toGiStatus falls back to idle for unknown phases', () => {
  assert.equal(toGiStatus(''), 'idle');
  assert.equal(toGiStatus(undefined), 'idle');
  assert.equal(toGiStatus('something-new'), 'idle');
});

test('toGiStatus reports error when an error is present and the engine is idle', () => {
  assert.equal(toGiStatus('idle', { hasError: true }), 'error');
});

test('toGiStatus prefers the live phase over a stale error', () => {
  assert.equal(toGiStatus('listening', { hasError: true }), 'listening');
});

test('isResponseBusy is true only while the assistant is producing a reply', () => {
  assert.equal(isResponseBusy('thinking'), true);
  assert.equal(isResponseBusy('generating_voice'), true);
  assert.equal(isResponseBusy('speaking'), true);
  assert.equal(isResponseBusy('listening'), false);
  assert.equal(isResponseBusy('idle'), false);
});

test('isVoiceActive is true for every non-idle phase', () => {
  assert.equal(isVoiceActive('idle'), false);
  assert.equal(isVoiceActive('listening'), true);
  assert.equal(isVoiceActive('speaking'), true);
});

test('toVoiceOptions maps voice profiles onto picker options', () => {
  const options = toVoiceOptions([
    { key: 'dean', displayName: 'Dean' },
    { key: 'amy', displayName: 'Amy' },
  ]);

  assert.deepEqual(options, [
    { id: 'dean', label: 'Dean' },
    { id: 'amy', label: 'Amy' },
  ]);
});

test('toVoiceOptions skips entries with no key and falls back to the key as a label', () => {
  const options = toVoiceOptions([
    { key: '', displayName: 'Nameless' },
    { key: 'raw' },
    null,
  ]);

  assert.deepEqual(options, [{ id: 'raw', label: 'raw' }]);
});

test('toVoiceOptions tolerates a non-array input', () => {
  assert.deepEqual(toVoiceOptions(undefined), []);
  assert.deepEqual(toVoiceOptions(null), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/hooks/giChatStatus.test.js`
Expected: FAIL — `Cannot find module './giChatStatus.js'`.

- [ ] **Step 3: Write the implementation**

Create `client/src/hooks/giChatStatus.js`:

```javascript
// Adapters between the live-speech engine's vocabulary and the vocabulary the
// ported gi-bleeding components expect. Kept separate from useGiChatEngine so
// they can be unit-tested without mounting React.

const PHASE_TO_STATUS = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  generating_voice: 'thinking',
  speaking: 'speaking',
};

const BUSY_PHASES = new Set(['thinking', 'generating_voice', 'speaking']);

export function toGiStatus(phase, { hasError = false } = {}) {
  const status = PHASE_TO_STATUS[phase] || 'idle';
  return hasError && status === 'idle' ? 'error' : status;
}

export function isResponseBusy(phase) {
  return BUSY_PHASES.has(phase);
}

export function isVoiceActive(phase) {
  return Boolean(phase) && phase !== 'idle';
}

export function toVoiceOptions(profiles) {
  if (!Array.isArray(profiles)) return [];

  return profiles
    .filter((profile) => profile && String(profile.key || '').trim())
    .map((profile) => ({
      id: String(profile.key).trim(),
      label: String(profile.displayName || '').trim() || String(profile.key).trim(),
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/hooks/giChatStatus.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/giChatStatus.js src/hooks/giChatStatus.test.js
git commit -m "feat: add gi chat status mapping helpers"
```

---

### Task 5: `useGiChatEngine`

**Files:**
- Create: `client/src/hooks/useGiChatEngine.js`

**Interfaces:**
- Consumes: `toGiStatus`, `isResponseBusy`, `isVoiceActive`, `toVoiceOptions` from Task 4; `useLiveSpeech` from `@/hooks/useLiveSpeech.js` (unmodified); `getFullActiveVoiceProfile`, `getModels` from `@/services/api.js` (unmodified); `buildLiveFastRefParams`, `normalizeLiveFastSettings` from `@/lib/liveFastSetup`; `buildVoiceProfiles(gptModels, sovitsModels)` from `@/lib/voiceProfiles`; `resolveChatbotSystemPrompt` from `@/lib/chatbotSystemPrompt`; `resolveChatbotDocuments`, `buildDocumentsContext`, `combineSystemPromptWithDocuments` from `@/lib/chatbotDocuments`; `useGpuStatus` from `@/lib/gpuStatus.jsx`; `sanitizeBackendError` from `@/lib/backendErrors`.
- Produces, for Task 6: a hook returning `{ status, messages, error, voiceActive, responseBusy, connecting, inputMode, setInputMode, micMuted, toggleMute, startConversation, stopConversation, send, newChat, voiceOptions, selectedVoiceId, setSelectedVoiceId, phase, audioSrc, selectedReplyId, playbackReady, onAudioEnded }`.

**Origin note for the implementer:** this hook reimplements the kiosk-only subset of the setup in `pages/LivePage.jsx:300-615`. It deliberately omits that page's model-selection, reference-picking, auto-sync, and TTS machinery, which exist to serve the training UI. Do not import from `LivePage.jsx`, and do not modify it.

- [ ] **Step 1: Write the hook**

Create `client/src/hooks/useGiChatEngine.js`:

```javascript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getFullActiveVoiceProfile, getModels } from '@/services/api.js';
import { useLiveSpeech } from '@/hooks/useLiveSpeech.js';
import { buildLiveFastRefParams, normalizeLiveFastSettings } from '@/lib/liveFastSetup';
import { buildVoiceProfiles } from '@/lib/voiceProfiles';
import { resolveChatbotSystemPrompt } from '@/lib/chatbotSystemPrompt';
import {
  buildDocumentsContext,
  combineSystemPromptWithDocuments,
  resolveChatbotDocuments,
} from '@/lib/chatbotDocuments';
import { useGpuStatus } from '@/lib/gpuStatus.jsx';
import { sanitizeBackendError } from '@/lib/backendErrors';
import { APP_MODE_CONFIG } from '@/lib/appMode';
import { isResponseBusy, isVoiceActive, toGiStatus, toVoiceOptions } from './giChatStatus.js';

// Kiosk-only engine setup for the gi skin. This is the subset of
// pages/LivePage.jsx:300-615 that a chat-only UI needs: resolve the active
// cloned-voice profile, build live-fast reference params from it, assemble the
// system prompt, and hand all of that to the shared useLiveSpeech hook.
export function useGiChatEngine() {
  const { workerReady, configured } = useGpuStatus();
  const backendQueryable = !configured || workerReady;

  const [activeProfile, setActiveProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [voiceProfiles, setVoiceProfiles] = useState([]);
  const [selectedVoiceId, setSelectedVoiceIdState] = useState('');
  const [inputMode, setInputMode] = useState('voice');
  const [clearedBeforeId, setClearedBeforeId] = useState('');

  const profileRequestRef = useRef(0);

  // System prompt + uploaded documents are read once at mount; the gi skin has
  // no editor for them (the Dean kiosk owns that UI).
  const systemPrompt = useMemo(() => {
    const prompt = resolveChatbotSystemPrompt();
    const documents = resolveChatbotDocuments();
    return combineSystemPromptWithDocuments(prompt, buildDocumentsContext(documents).text);
  }, []);

  const loadActiveProfile = useCallback(async () => {
    const requestId = ++profileRequestRef.current;
    try {
      const res = await getFullActiveVoiceProfile();
      if (profileRequestRef.current !== requestId) return;
      setActiveProfile(res.data || null);
      setProfileError('');
    } catch (err) {
      if (profileRequestRef.current !== requestId) return;
      if (err.response?.status === 404) {
        setActiveProfile(null);
        setProfileError('No voice profile is active yet.');
        return;
      }
      setProfileError(
        sanitizeBackendError(err.response?.data?.error || err.message || 'Could not load the voice profile.')
      );
    }
  }, []);

  // buildVoiceProfiles takes (gptModels, sovitsModels) — the two arrays that
  // getModels() returns — and groups them into { key, displayName, … } profiles.
  const loadVoiceProfiles = useCallback(async () => {
    try {
      const res = await getModels();
      setVoiceProfiles(buildVoiceProfiles(res.data.gpt || [], res.data.sovits || []) || []);
    } catch {
      // A missing profile list is not fatal — the picker simply hides itself.
      setVoiceProfiles([]);
    }
  }, []);

  useEffect(() => {
    if (!backendQueryable) return;
    loadActiveProfile();
    loadVoiceProfiles();
  }, [backendQueryable, loadActiveProfile, loadVoiceProfiles]);

  useEffect(() => {
    const activeKey = String(activeProfile?.key || '').trim();
    if (activeKey) setSelectedVoiceIdState(activeKey);
  }, [activeProfile]);

  const refParams = useMemo(() => {
    if (!activeProfile) return null;
    return buildLiveFastRefParams({
      primaryPath: activeProfile.ref_audio_path || '',
      promptText: activeProfile.prompt_text || '',
      promptLang: activeProfile.prompt_lang || 'en',
      auxRefAudios: (activeProfile.aux_ref_audio_paths || []).map((path) => ({ path })),
      settings: normalizeLiveFastSettings(activeProfile.defaults || {}),
    });
  }, [activeProfile]);

  const fastSettings = useMemo(
    () => normalizeLiveFastSettings(activeProfile?.defaults || {}),
    [activeProfile]
  );

  const liveSpeech = useLiveSpeech({
    refParams,
    fullRefParams: null,
    engine: APP_MODE_CONFIG.defaultLiveEngine,
    replyMode: 'phrases',
    language: activeProfile?.text_lang || 'en',
    voiceProfileId: activeProfile?.voiceProfileId || '',
    systemPrompt,
    fastMaxChunkWords: fastSettings.maxChunkWords,
    fastMaxSentencesPerChunk: fastSettings.maxSentencesPerChunk,
  });

  // "New chat" clears the visible transcript without touching engine state
  // (design decision D3 — no persistence, no conversation list).
  const visibleMessages = useMemo(() => {
    if (!clearedBeforeId) return liveSpeech.messages;
    const cutoff = liveSpeech.messages.findIndex((message) => message.id === clearedBeforeId);
    return cutoff === -1 ? liveSpeech.messages : liveSpeech.messages.slice(cutoff + 1);
  }, [liveSpeech.messages, clearedBeforeId]);

  const newChat = useCallback(() => {
    const last = liveSpeech.messages[liveSpeech.messages.length - 1];
    setClearedBeforeId(last ? last.id : '');
  }, [liveSpeech.messages]);

  // Runtime voice switching is NOT implemented in this version. activateVoiceProfile()
  // posts a whole profile payload (voiceProfileId, ref_audio_path, prompt_text, aux
  // refs, defaults) built from the target profile's saved rank-1 config, and the new
  // weights then have to be loaded via selectModels. That is the modelLoading /
  // autoVoiceProfileSync chain this hook deliberately does not port. The picker
  // therefore renders read-only, showing which cloned voice is active.
  // See "Known Limitations" and the follow-up note at the end of this plan.
  const setSelectedVoiceId = useCallback(() => {}, []);

  const toggleMute = useCallback(() => {
    if (liveSpeech.isMicInputEnabled) {
      liveSpeech.disableMicInput();
    } else {
      liveSpeech.enableMicInput();
    }
  }, [liveSpeech]);

  const error = liveSpeech.error || profileError;

  return {
    status: toGiStatus(liveSpeech.phase, { hasError: Boolean(error) }),
    messages: visibleMessages,
    error,
    voiceActive: isVoiceActive(liveSpeech.phase),
    responseBusy: isResponseBusy(liveSpeech.phase),
    connecting: !backendQueryable,
    inputMode,
    setInputMode,
    micMuted: !liveSpeech.isMicInputEnabled,
    toggleMute,
    startConversation: liveSpeech.start,
    stopConversation: liveSpeech.stop,
    send: liveSpeech.start,
    newChat,
    voiceOptions: toVoiceOptions(voiceProfiles),
    selectedVoiceId,
    setSelectedVoiceId,
    // Playback plumbing — GiChatPage drives a hidden <audio> element from these.
    phase: liveSpeech.phase,
    audioSrc: liveSpeech.audioSrc,
    selectedReplyId: liveSpeech.selectedReplyId,
    playbackReady: liveSpeech.shouldPlayAudio && Boolean(liveSpeech.audioSrc),
    onAudioEnded: liveSpeech.onAudioEnded,
  };
}
```

- [ ] **Step 2: Verify the module resolves**

Run: `npm run build`
Expected: build succeeds with no unresolved imports. (`buildVoiceProfiles` is confirmed to have the signature `(gptModels, sovitsModels)` and to return entries shaped `{ key, displayName, gptCandidates, sovitsCandidates }` — see `src/lib/voiceProfiles.js:77-107` — which is the contract `toVoiceOptions` consumes.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useGiChatEngine.js
git commit -m "feat: add useGiChatEngine kiosk engine adapter"
```

---

### Task 6: `GiChatPage`

**Files:**
- Create: `client/src/pages/GiChatPage.jsx`

**Interfaces:**
- Consumes: `useGiChatEngine` (Task 5); all nine `components/gi/*` exports (Task 3); the `.gi-root` class (Task 2).
- Produces: a default export `GiChatPage`, imported by `App.jsx` in Task 1.

- [ ] **Step 1: Write the page**

Create `client/src/pages/GiChatPage.jsx`. Adapted from gi-bleeding's `ChatPage`: the conversation-list props are gone (D3), `AvatarPicker`/`AvatarDiagnostics`/avatar-video props are gone (D4 and the LiveKit non-goal), and a hidden `<audio>` element is added to drive the engine's cloned-voice playback.

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, SquarePen } from 'lucide-react';

import { cn } from '@/lib/utils';
import { AvatarStage } from '@/components/gi/AvatarStage.jsx';
import { ChatHistory } from '@/components/gi/ChatHistory.jsx';
import { ChatList } from '@/components/gi/ChatList.jsx';
import { Composer } from '@/components/gi/Composer.jsx';
import { DisclaimerBanner } from '@/components/gi/DisclaimerBanner.jsx';
import { VoicePicker } from '@/components/gi/VoicePicker.jsx';
import { useGiChatEngine } from '@/hooks/useGiChatEngine.js';
import { nextAudioErrorAction } from '@/hooks/liveConversation.js';

export default function GiChatPage() {
  const chat = useGiChatEngine();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileView, setMobileView] = useState('chat');
  const scrollViewportRef = useRef(null);
  const footerRef = useRef(null);
  const audioRef = useRef(null);
  const [footerHeight, setFooterHeight] = useState(0);

  useEffect(() => {
    document.title = 'GI Bleeding AI Medical Guide';
  }, []);

  const hasMessages = chat.messages.length > 0;
  const controlsBusy = chat.connecting || chat.responseBusy;

  const chatScrollKey = useMemo(
    () =>
      JSON.stringify({
        error: Boolean(chat.error),
        voiceOptions: chat.voiceOptions.length,
        inputMode: chat.inputMode,
      }),
    [chat.error, chat.inputMode, chat.voiceOptions.length]
  );

  useEffect(() => {
    const footerElement = footerRef.current;
    const scrollViewportElement = scrollViewportRef.current;
    if (!footerElement || !scrollViewportElement || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const updateFooterHeight = () => {
      const nextFooterHeight = footerElement.getBoundingClientRect().height;
      const distanceFromBottom =
        scrollViewportElement.scrollHeight
        - scrollViewportElement.scrollTop
        - scrollViewportElement.clientHeight;
      const pinnedToBottom = distanceFromBottom <= 96;
      setFooterHeight(nextFooterHeight);
      if (pinnedToBottom) {
        requestAnimationFrame(() => {
          scrollViewportElement.scrollTop = scrollViewportElement.scrollHeight;
        });
      }
    };

    updateFooterHeight();
    const observer = new ResizeObserver(updateFooterHeight);
    observer.observe(footerElement);
    return () => observer.disconnect();
  }, [chat.inputMode]);

  // Reply audio plays as a chain of clips that only advances on `ended`. This
  // mirrors pages/LivePage.jsx:3115-3142 exactly, including the retry-then-skip
  // recovery — without it, one clip failing to decode stalls the rest of the
  // reply and the voice silently cuts off mid-answer.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!chat.playbackReady) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    if (audio.getAttribute('src') !== chat.audioSrc) {
      audio.src = chat.audioSrc;
      audio.load();
    }
    audio.play().catch(() => {});
  }, [chat.audioSrc, chat.selectedReplyId, chat.playbackReady]);

  const audioErrorStateRef = useRef({ src: '', retried: false });

  function handleAudioError() {
    const audio = audioRef.current;
    // Ignore errors that aren't from an active reply clip — clearing the src
    // during teardown fires an error on an empty element.
    if (!audio || chat.phase !== 'speaking') return;
    const { action, retryState } = nextAudioErrorAction(audioErrorStateRef.current, chat.audioSrc);
    audioErrorStateRef.current = retryState;
    if (action === 'retry') {
      try {
        audio.load();
        audio.play().catch(() => { chat.onAudioEnded(); });
      } catch {
        chat.onAudioEnded();
      }
    } else if (action === 'skip') {
      chat.onAudioEnded();
    }
  }

  const composer = (
    <Composer
      disabled={controlsBusy}
      loading={chat.connecting}
      active={chat.voiceActive}
      onStart={chat.startConversation}
      onStop={chat.stopConversation}
      micMuted={chat.micMuted}
      onToggleMute={chat.toggleMute}
      inputMode={chat.inputMode}
      onSend={chat.send}
    />
  );

  return (
    <div className="gi-root relative flex h-screen bg-surface text-ink">
      <div className="flex min-h-0 flex-1 flex-row">
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          />
        )}

        <aside
          className={cn(
            'z-50 shrink-0 border-r border-slate-200 bg-white transition-all duration-300',
            sidebarOpen
              ? 'fixed inset-y-0 left-0 flex w-64 flex-col p-3 lg:relative lg:z-0 lg:block lg:bg-white/60'
              : 'hidden lg:flex lg:w-14 lg:flex-col lg:items-center lg:gap-2 lg:px-2 lg:py-3'
          )}
        >
          {sidebarOpen ? (
            <>
              <button
                type="button"
                aria-label="Hide chat history"
                onClick={() => setSidebarOpen(false)}
                className="absolute right-2 top-2 rounded-lg p-2 text-ink-muted transition hover:bg-slate-100 hover:text-ink"
              >
                <PanelLeftClose className="size-5" />
              </button>

              <ChatHistory
                onNewChat={() => {
                  chat.newChat();
                  setSidebarOpen(false);
                }}
              />
            </>
          ) : (
            <>
              <button
                type="button"
                aria-label="Show chat history"
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-2 text-ink-muted transition hover:bg-slate-100 hover:text-ink"
              >
                <PanelLeftOpen className="size-5" />
              </button>
              <button
                type="button"
                aria-label="New chat"
                onClick={chat.newChat}
                className="mt-2 rounded-lg p-2 text-ink-muted transition hover:bg-slate-100 hover:text-ink"
              >
                <SquarePen className="size-5" />
              </button>
            </>
          )}
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/60 px-4 backdrop-blur-sm lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              {!sidebarOpen && (
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Show chat history"
                  className="rounded-lg p-1.5 text-ink-muted transition hover:bg-slate-100 hover:text-ink lg:hidden"
                >
                  <PanelLeftOpen className="size-5" />
                </button>
              )}
              <h1 className="hidden truncate text-base font-semibold text-black lg:block">
                GI Bleeding Chatbot
              </h1>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="flex shrink-0 rounded-full bg-slate-100 p-1">
                <button
                  type="button"
                  disabled={controlsBusy}
                  onClick={() => chat.setInputMode('voice')}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                    chat.inputMode === 'voice' ? 'bg-white text-black shadow' : 'text-ink-muted hover:text-ink'
                  )}
                >
                  Voice
                </button>
                <button
                  type="button"
                  disabled={controlsBusy || chat.voiceActive}
                  title={chat.voiceActive ? 'End the voice session to switch to text.' : undefined}
                  onClick={() => chat.setInputMode('text')}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                    chat.inputMode === 'text' ? 'bg-white text-black shadow' : 'text-ink-muted hover:text-ink'
                  )}
                >
                  Text
                </button>
              </div>

              <div className="flex shrink-0 rounded-full bg-slate-100 p-1 lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileView('chat')}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold transition',
                    mobileView === 'chat' ? 'bg-white text-black shadow' : 'text-ink-muted hover:text-ink'
                  )}
                >
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => setMobileView('avatar')}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold transition',
                    mobileView === 'avatar' ? 'bg-white text-black shadow' : 'text-ink-muted hover:text-ink'
                  )}
                >
                  Avatar
                </button>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <section
              className={cn(
                'min-h-0 flex-col items-center justify-center',
                mobileView === 'avatar'
                  ? 'absolute inset-x-0 bottom-0 top-14 z-10 flex bg-surface p-0'
                  : 'hidden',
                'lg:relative lg:inset-auto lg:top-auto lg:z-0 lg:flex lg:flex-1 lg:justify-center lg:border-b-0 lg:bg-transparent lg:p-6'
              )}
            >
              <div
                className={cn(
                  'w-full',
                  mobileView === 'avatar' ? 'h-full' : 'max-w-[160px] sm:max-w-[240px]',
                  'lg:aspect-[4/3] lg:h-auto lg:max-w-md'
                )}
              >
                <AvatarStage status={chat.status} fullScreen={mobileView === 'avatar'} />
              </div>

              {mobileView === 'avatar' && (
                <div className="absolute bottom-6 left-4 right-4 z-20 lg:hidden">{composer}</div>
              )}

              <div className="mt-4 hidden space-y-1 text-center lg:block">
                <h2 className="text-lg font-semibold">GI Bleeding Chatbot</h2>
                <p className="mx-auto max-w-sm text-sm text-ink-muted">
                  Ask me about GI bleeding education material. Tap the voice button to start a
                  conversation, then just speak — tap again to end it.
                </p>
              </div>
            </section>

            <main
              className={cn(
                'flex min-h-0 w-full flex-col border-slate-200 bg-white/40 lg:w-[48%] lg:flex-none lg:border-l',
                mobileView === 'avatar' ? 'hidden lg:flex' : 'flex-1'
              )}
            >
              <DisclaimerBanner />

              <div
                ref={scrollViewportRef}
                className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
                style={{ paddingBottom: `${footerHeight + 16}px` }}
              >
                {hasMessages ? (
                  <ChatList messages={chat.messages} status={chat.status} scrollKey={chatScrollKey} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                    <p className="text-sm text-ink-muted">
                      {chat.inputMode === 'text'
                        ? 'Type a question below to get started'
                        : 'Start a conversation — click the mic'}
                    </p>
                  </div>
                )}
              </div>

              <div ref={footerRef} className="shrink-0 bg-white/40">
                {chat.error && (
                  <p className="px-4 pb-2 text-center text-xs text-red-600" role="alert">
                    {chat.error}
                  </p>
                )}

                {chat.voiceOptions.length > 0 && (
                  <div className="px-4 pb-2">
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      {/* Read-only in this version — see Known Limitations. */}
                      <VoicePicker
                        disabled
                        options={chat.voiceOptions}
                        value={chat.selectedVoiceId}
                        onChange={chat.setSelectedVoiceId}
                      />
                    </div>
                  </div>
                )}

                <div className="px-4 pb-4 pt-2">{composer}</div>
              </div>
            </main>
          </div>
        </div>
      </div>

      {/* Cloned-voice playback. Driven imperatively — see the effect above. */}
      <audio ref={audioRef} className="hidden" onEnded={chat.onAudioEnded} onError={handleAudioError} />
    </div>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no unresolved imports.

- [ ] **Step 3: Commit**

```bash
git add src/pages/GiChatPage.jsx
git commit -m "feat: add GiChatPage layout"
```

---

### Task 7: Build wiring and regression check

**Files:**
- Create: `client/.env.gi`
- Modify: `client/package.json`

**Interfaces:**
- Consumes: the `gi` mode from Task 1.
- Produces: `npm run dev:gi` (port 5176) and `npm run build:gi` (→ `dist-gi`).

- [ ] **Step 1: Create the env file**

Create `client/.env.gi`:

```
VITE_APP_MODE=gi
```

- [ ] **Step 2: Add the scripts**

In `client/package.json`, add to `scripts` after `dev:chatbot`:

```json
    "dev:gi": "vite --mode gi --host 0.0.0.0 --port 5176 --strictPort",
```

and after `build:chatbot`:

```json
    "build:gi": "vite build --mode gi --outDir dist-gi",
```

- [ ] **Step 3: Confirm `dist-gi` is ignored by git**

Run: `git check-ignore -v dist-gi`
Expected: a matching `.gitignore` rule is printed. If it prints nothing, add `dist-gi` alongside the other `dist-*` entries in `client/.gitignore` (or the repo-root `.gitignore`, wherever `dist-chatbot` is listed) and commit that change with this task.

- [ ] **Step 4: Run the full test suite**

Run: `node --test src/`
Expected: PASS. All pre-existing tests plus the new `appMode` and `giChatStatus` tests.

- [ ] **Step 5: Verify every build target still compiles**

Run each and confirm success:

```bash
npm run build
npm run build:training
npm run build:live-fast
npm run build:chatbot
npm run build:gi
```

Expected: all five succeed. `build:chatbot` and `build:live-fast` succeeding is the regression gate — the only shared files touched are `appMode.js` (additive), `tailwind.config.js` (additive), `globals.css` (additive), and `App.jsx` (gi-gated branches).

- [ ] **Step 6: Manual verification**

Run: `npm run dev:gi`, open `http://localhost:5176`, and confirm each of:

1. The gi layout renders — navy sidebar heading, avatar orb centre, chat right. No Training/Live Fast/Text to Speech nav appears anywhere.
2. The app-shell header and footer are absent (the page is full-bleed `h-screen`).
3. Clicking the mic starts a voice session; the orb shows pulse rings; a spoken question produces a transcript bubble and a cloned-voice reply that is audible.
4. The mute button appears while active and toggles mic input.
5. Switching to Text mode shows the textarea; Enter sends; the reply is spoken.
6. The voice picker lists the available profiles with the active one selected, and is disabled (read-only — see Known Limitations).
7. "New chat" empties the transcript; the empty-state prompt returns.
8. The sidebar collapses to the 14-unit rail and reopens.
9. At a narrow window the Chat/Avatar toggle appears and the avatar view shows the composer overlay.
10. The disclaimer banner dismisses and stays dismissed after reload.

- [ ] **Step 7: Commit**

```bash
git add .env.gi package.json
git commit -m "feat: add gi dev and build targets"
```

---

## Known Limitations

Record these; do not treat them as defects during implementation.

- **The voice picker is read-only.** It shows which cloned voice is active but cannot switch. `activateVoiceProfile(profile)` posts a full profile payload assembled from the target's saved rank-1 config, after which the new weights must be loaded via `selectModels` — that is the `modelLoading` / `autoVoiceProfileSync` chain this hook deliberately does not port. Making the picker functional is scoped as follow-up work, not part of this plan.
- **No conversation persistence.** `newChat` hides earlier messages by slicing on the last message id; the engine's own history is untouched and nothing is stored. This is design decision D3.
- **No system-prompt editor.** The gi skin reads the prompt and documents at mount from whatever the Dean kiosk UI last saved. It cannot edit them.
- **Content is not GI-specific.** This plan ports the interface only. The assistant answers using the existing `chatbotSystemPrompt`, not GI-bleeding material. Changing that is separate work.
- **`send` is wired to `start`.** `useLiveSpeech` exposes no text-submit entry point. Text mode will start a voice session rather than submit typed text until a text path is added to the engine — which would require modifying `useLiveSpeech.js`, excluded by the Global Constraints. Verify item 5 against this limitation and report it rather than editing the engine.
