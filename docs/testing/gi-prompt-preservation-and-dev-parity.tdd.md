# GI prompt preservation and dev environment parity — TDD evidence

## Source

The user journeys were derived from the request to keep the GI lesson chatbot in character and
to make the dev GI distribution use the same authenticated lesson UI as staging while retaining
dev-specific backend and voice settings.

## User journeys

- As a student, I want the GI scope gate to remain structurally prominent on every realtime
  session so that conversational delivery guidance does not override the lesson boundary.
- As a developer deploying the dev GI site, I want an explicit dev environment override so that
  the browser's authentication, backend audience, routing, and voice settings cannot silently
  drift from the deployed dev services.
- As a developer with a private `.env.gi.local`, I want deployment cleanup to restore that file
  so that deploying the shared dev configuration does not erase my local settings.

## Task report

| Behavior | Validation | Evidence |
|---|---|---|
| Realtime prompt cleanup preserves Markdown headings and paragraph boundaries | `npm test` in `live-gateway/` | 156/156 tests passed, including the scoped-prompt structure regression. |
| Language and prosody guidance precede the prompt body, leaving the final scope check last | `node --experimental-test-coverage --test src/services/openaiRealtimeEvents.test.js` | 19/19 focused tests passed; `openaiRealtimeEvents.js` line coverage was 80.77%. |
| Dev GI builds with Entra sign-in, origin-relative endpoints, and the dev voice | `node --test src/giPublicAccess.test.js` | The final focused run passed 14/14 tests after pulling remote commit `0a51da5`. |
| Client deployment preserves a pre-existing local override | `node --test src/giPublicAccess.test.js` | RED: the new preservation test failed against the delete-only cleanup. GREEN: 14/14 passed after backup/restore cleanup was implemented. |
| Existing client behavior remains intact | `node --test "src/**/*.test.js"` | 332/332 client tests passed. |
| The production-shaped dev GI artifact contains the intended configuration | `npm run build:gi` with `client/env/dev/gi.env` injected as process variables | Vite transformed 2,129 modules; the bundle contained `DeanVoice`, the Entra client ID, and `/common`, and excluded `deanvoice-v1` and the base API fallback. |

## Test specification

| # | What is guaranteed | Test file or command | Type | Result |
|---|---|---|---|---|
| 1 | Prompt cleanup does not flatten the GI scope headings or paragraph structure | `live-gateway/src/services/openaiRealtimeEvents.test.js` | Unit | PASS |
| 2 | Prosody and language guidance cannot displace the prompt body's final scope check | `live-gateway/src/services/openaiRealtimeEvents.test.js` | Unit | PASS |
| 3 | The dev GI client enables MSAL and uses the token audience both dev backends verify | `client/src/giPublicAccess.test.js` | Configuration integration | PASS |
| 4 | Dev stays origin-relative and pins `DeanVoice`, while staging retains `deanvoice-v1` | `client/src/giPublicAccess.test.js` | Configuration regression | PASS |
| 5 | The actual GI bundle resolves the new dev override instead of the base fallback | `npm run build:gi` plus compiled-asset assertions | Build integration | PASS |
| 6 | A deployment-specific override cannot permanently replace a developer's existing `.env.gi.local` | `client/src/giPublicAccess.test.js` | Deployment-script regression | PASS |

## Coverage and known gaps

Node's focused coverage report measured `openaiRealtimeEvents.js` at 80.77% line, 52.33% branch,
and 70% function coverage. The new prompt-order and whitespace paths are exercised, but the file
also contains unrelated event-mapping branches outside this change. The client configuration test
reads deployment files as text, so statement coverage is not meaningful for that portion.

No valid RED run was preserved in the supplied handoff for the prompt or environment-parity
changes: their implementation had already been applied before this continuation began. The local
override preservation follow-up does have observed RED and GREEN evidence. No CloudFront or
gateway deployment was performed; the hosted five-turn conversation remains the required
post-deployment check.

## Merge evidence

No checkpoint commits were created during this continuation. The remote branch was fast-forwarded
to `0a51da5` before the final verification, and the five implementation/configuration/test files
plus this evidence report remain uncommitted for review.
