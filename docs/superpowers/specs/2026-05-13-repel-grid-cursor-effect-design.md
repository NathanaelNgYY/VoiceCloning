# Repel Grid Cursor Effect — Design Spec

**Date:** 2026-05-13  
**Scope:** Training page only (`client/src/pages/TrainingPage.jsx`)  
**Constraint:** No backend changes, no component files touched.

---

## Overview

Add a cursor-reactive dot grid to the Training page background. A grid of small dots fills the full viewport. When the cursor moves near a dot, the dot is pushed away (repelled) and springs back when the cursor leaves — like a magnetic field. Dots shift from slate to indigo as they're displaced, and a soft radial glow follows the cursor.

The effect is implemented entirely inside `TrainingPage.jsx` using a fixed `<canvas>` element and a `useEffect` animation loop.

---

## Architecture

### What changes

One file only: `client/src/pages/TrainingPage.jsx`

Two additions to the existing component:

1. **`useEffect` with canvas setup** — initialises the dot grid, starts the `requestAnimationFrame` loop, registers a `window` `mousemove` listener, and cleans up both on unmount (cancel RAF + remove listener). Also handles `window resize` to rebuild the grid.

2. **`<canvas>` in JSX** — rendered with `position: fixed; inset: 0; z-index: -5; pointer-events: none; aria-hidden="true"`. Sits above the existing animated orb layer (`z-index: -10`) but below all page content.

### Why fixed canvas, not a component

The user's constraint is no new component files. A fixed canvas rendered inside TrainingPage's JSX achieves the same result and is automatically mounted/unmounted with the route.

---

## Physics

| Parameter | Value | Effect |
|---|---|---|
| Grid spacing | `32px` | ~600–900 dots at 1080p |
| Repel radius | `90px` | Area of influence around cursor |
| Repel force | `(radius - dist) / radius * 2.8` | Stronger push the closer the cursor |
| Spring stiffness | `0.12` | Pulls dot back to origin each frame |
| Velocity damping | `0.75` | Multiplied each frame; prevents oscillation |

Update loop per dot per frame:
1. Apply spring: `vx += (ox - x) * spring`
2. If cursor within repel radius: apply outward force
3. Damp: `vx *= damp`
4. Integrate: `x += vx`

---

## Visual Style

| Property | Value |
|---|---|
| Dot colour (rest) | `rgba(148, 163, 184, 0.35)` — slate-400 at 35% |
| Dot colour (displaced) | interpolates toward `rgba(99, 102, 241, 0.8)` — indigo-500 |
| Dot radius (rest) | `1.2px` |
| Dot radius (displaced) | up to `2.6px` — scales with displacement |
| Cursor glow | Radial gradient, indigo at 10% → transparent, 70px radius |
| Displacement threshold | `16px` — full colour shift at this distance from origin |

Colour and size both interpolate on `t = clamp(displaced / 16, 0, 1)`.

---

## Lifecycle

- **Mount**: `useEffect` fires, grid is built from `window.innerWidth` / `window.innerHeight`, RAF loop starts, `mousemove` listener added to `window`.
- **Resize**: `resize` listener rebuilds the dot array and resets canvas dimensions.
- **Unmount** (route change): cleanup function cancels the active RAF ID and removes both event listeners. No memory leaks.

---

## Constraints

- Training page only — canvas is part of TrainingPage's component tree, not App.
- `pointer-events: none` — zero interference with form inputs, buttons, uploads.
- No React state used for animation — all imperative canvas; no re-renders triggered.
- No new files, no component edits, no backend changes.
