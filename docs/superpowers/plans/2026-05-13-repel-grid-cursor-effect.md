# Repel Grid Cursor Effect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cursor-reactive dot grid to the Training page background — dots spring away from the cursor and snap back when it leaves.

**Architecture:** A fixed `<canvas>` element is rendered inside `TrainingPage.jsx` with `position: fixed; inset: 0; z-index: -5; pointer-events: none`. A single `useEffect` builds the dot grid from window dimensions, runs a `requestAnimationFrame` loop, tracks `mousemove` on `window`, and cleans up fully on unmount. No new files, no component edits, no backend changes.

**Tech Stack:** React 18 `useRef` / `useEffect`, Canvas 2D API, `requestAnimationFrame`.

---

## File Map

| Action | File |
|---|---|
| Modify | `client/src/pages/TrainingPage.jsx` |

---

### Task 1: Add canvas ref and repel grid effect to TrainingPage

**Files:**
- Modify: `client/src/pages/TrainingPage.jsx`

- [ ] **Step 1: Add `canvasRef` to the existing refs block**

In `TrainingPage.jsx`, the existing refs are declared around line 42–45:

```js
const restoredSessionRef = useRef(null);
const noticeTimeoutRef = useRef(null);
const previousStatusRef = useRef(null);
const noticesReadyRef = useRef(false);
```

Add `canvasRef` immediately after `noticesReadyRef`:

```js
const restoredSessionRef = useRef(null);
const noticeTimeoutRef = useRef(null);
const previousStatusRef = useRef(null);
const noticesReadyRef = useRef(false);
const canvasRef = useRef(null);
```

- [ ] **Step 2: Add the repel grid `useEffect`**

Add this `useEffect` after the last existing `useEffect` block (the one ending around line 144) and before `async function handleStart()`:

```js
useEffect(() => {
  const canvas = canvasRef.current;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let rafId;
  let dots = [];
  const mouse = { x: -999, y: -999 };

  function buildGrid() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    const spacing = 32;
    const cols = Math.floor(W / spacing) + 1;
    const rows = Math.floor(H / spacing) + 1;
    const offX = (W - (cols - 1) * spacing) / 2;
    const offY = (H - (rows - 1) * spacing) / 2;

    dots = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ox = offX + c * spacing;
        const oy = offY + r * spacing;
        dots.push({ ox, oy, x: ox, y: oy, vx: 0, vy: 0 });
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const REPEL = 90, SPRING = 0.12, DAMP = 0.75;
    for (const d of dots) {
      const dx = d.x - mouse.x;
      const dy = d.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      d.vx += (d.ox - d.x) * SPRING;
      d.vy += (d.oy - d.y) * SPRING;

      if (dist < REPEL && dist > 0) {
        const force = (REPEL - dist) / REPEL * 2.8;
        d.vx += (dx / dist) * force;
        d.vy += (dy / dist) * force;
      }

      d.vx *= DAMP;
      d.vy *= DAMP;
      d.x += d.vx;
      d.y += d.vy;

      const displaced = Math.sqrt((d.x - d.ox) ** 2 + (d.y - d.oy) ** 2);
      const t = Math.min(displaced / 16, 1);
      const alpha = 0.35 + t * 0.45;
      const radius = 1.2 + t * 1.4;
      const r = Math.round(148 + t * (99 - 148));
      const g = Math.round(163 + t * (102 - 163));
      const b = Math.round(184 + t * (241 - 184));

      ctx.beginPath();
      ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fill();
    }

    if (mouse.x > 0) {
      const grd = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 70);
      grd.addColorStop(0, 'rgba(99,102,241,0.10)');
      grd.addColorStop(1, 'rgba(99,102,241,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, 70, 0, Math.PI * 2);
      ctx.fill();
    }

    rafId = requestAnimationFrame(draw);
  }

  function onMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }

  function onResize() {
    buildGrid();
  }

  buildGrid();
  draw();
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('resize', onResize);

  return () => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('resize', onResize);
  };
}, []);
```

- [ ] **Step 3: Add the `<canvas>` element to the JSX return**

The JSX return starts with:

```jsx
return (
  <div className="animate-fade-in flex min-h-0 flex-1 flex-col justify-center py-8">
    <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
```

Add the canvas as the **first child** of that outer `<div>`, immediately before `<FloatingNotice>`:

```jsx
return (
  <div className="animate-fade-in flex min-h-0 flex-1 flex-col justify-center py-8">
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', inset: 0, zIndex: -5, pointerEvents: 'none' }}
      aria-hidden="true"
    />
    <FloatingNotice notice={notice} onClose={() => setNotice(null)} />
```

- [ ] **Step 4: Start the dev server and verify visually**

In two terminals:

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
```

Open `http://localhost:5173` (the Training page). Verify:
- A subtle grid of slate dots fills the entire background
- Moving the cursor pushes nearby dots away
- Dots spring back when the cursor moves away
- A faint indigo glow follows the cursor
- All form controls (inputs, file upload, buttons, sliders) work normally
- Navigate to another page (`/inference` or `/live`) — the grid disappears
- Navigate back — the grid reappears

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TrainingPage.jsx
git commit -m "feat: add repel grid cursor effect to Training page"
```
