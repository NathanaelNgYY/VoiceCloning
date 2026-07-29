# GI responsive UI TDD evidence

## Source and user journeys

No source plan was provided. The guarantees were derived from the supplied annotated screenshots:

- A learner can distinguish the home-page supporting copy from the search control without the two feeling crowded.
- A learner can scan the content outline using a clear section-heading/topic-label hierarchy.
- A learner on a phone sees Transcript and AI Chatbot as two evenly sized controls.
- A learner can scroll a bounded transcript on phone or desktop while the lesson video remains visible.
- A learner can seek from a transcript timestamp on a phone without the video being promoted to fullscreen.

## RED and GREEN evidence

| Behavior | RED evidence | GREEN evidence | Guarantee |
|---|---|---|---|
| Home search spacing | `node --test src/pages/giResponsiveLayout.test.js` — 5 tests failed before implementation | Same command — 5/5 passed | Responsive margin separates supporting copy and search form. |
| Outline hierarchy | Same RED run | Same GREEN run | Outline heading uses `text-lg`; topic labels use `text-xs`. |
| Inline mobile video | Same RED run | Same GREEN run | Lesson video renders with `playsInline`. |
| Equal phone tabs | Same RED run | Same GREEN run | Tabs render as a two-column, full-width phone grid. |
| Transcript scrolling | Same RED run | Same GREEN run | Transcript has a bounded viewport and independent vertical overflow. |

## Rendered browser evidence

Read-only local QA ran at 375×812 and 1440×1000 using the GI demo build:

- Home supporting-text/search gap: 24px at 375px (`sm:mt-8` provides 32px from 640px upward).
- Phone tab widths: 159px and 159px inside a 325px tab group.
- Phone transcript viewport: 310px client height, 5,957px scroll height; setting `scrollTop` to 100 succeeded.
- Desktop transcript viewport: 395px client height, 2,678px scroll height, computed `overflow-y: auto`.
- Outline computed sizes: 18px heading and 12px topic labels.
- Selecting the `0:23` transcript control sought to 23.45 seconds; standard and WebKit fullscreen states both remained false.

## Full verification

| Check | Command | Result |
|---|---|---|
| Targeted regression | `node --test src/pages/giResponsiveLayout.test.js` | PASS — 5/5 |
| Client suite | `node --test` | PASS — 220/220 |
| Coverage | `node --test --experimental-test-coverage` | PASS — 96.33% lines, 96.46% functions, 74.60% branches |
| GI production build | `npm run build:gi` | PASS |
| Diff hygiene | `git diff --check` | PASS |
| Credential-pattern scan on changed UI files | `rg ...` | PASS — no matches |

## Known gaps

- The Node coverage report includes imported JavaScript modules; JSX layout contracts are guarded by source-level regression tests plus rendered browser measurements. Aggregate branch coverage is 74.60%, below the workflow's 80% target, and was not broadened into unrelated legacy test work.
- `npm audit --omit=dev --audit-level=high` reports existing advisories in Axios/form-data (high) and follow-redirects/React Router (moderate). Dependency upgrades were kept out of this scoped UI change.
- iOS Safari native fullscreen behavior cannot be emulated exactly in desktop Chromium. The rendered interaction stayed inline, and the platform-specific `playsinline` attribute is present.
