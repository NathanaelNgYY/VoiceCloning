# Public GI access — TDD evidence

## Source

The user journey and acceptance criteria were derived during this TDD run.

## User journey

As a visitor opening the staging GI CloudFront site, I want to land directly on
the lecture search page so that I can browse lessons without seeing an SSO
screen.

## Task report

| Behavior | Validation | Evidence |
|---|---|---|
| Staging explicitly disables the GI authentication gate | `node --test src/giPublicAccess.test.js` | RED: 4 tests failed before implementation because no auth-off flag or public route handling existed. GREEN: 4/4 passed after implementation. |
| Public visitors can open search, lesson, and chat routes without authentication | `node --test src/giPublicAccess.test.js` | The protected-route wrapper returns its children when staging auth is disabled. |
| `/login` cannot render the SSO page in the public build | Local production preview checked with Playwright | Navigating to `/login` ended at `/`; the lecture heading was present and Microsoft sign-in text was absent. |
| Public pages do not show a nonfunctional sign-out action | Unit/source regression test and Playwright preview | Search and lesson controls are conditional on enabled, authenticated access; the preview contained zero `Sign out` elements. |
| Existing client behavior remains intact | `node --test` | 289/289 client tests passed. |
| The staging GI artifact compiles | `npm run build:gi` with staging GI environment values | Vite production build completed successfully (2,121 modules transformed). |

## Test specification

| # | What is guaranteed | Test or command | Type | Result |
|---|---|---|---|---|
| 1 | The staging GI environment sets `VITE_GI_AUTH_ENABLED=false` | `src/giPublicAccess.test.js` | Configuration regression | PASS |
| 2 | Disabled GI auth bypasses the route gate and redirects `/login` to `/` | `src/giPublicAccess.test.js` | Routing regression | PASS |
| 3 | Disabled GI auth prevents MSAL bootstrap | `src/giPublicAccess.test.js` | Bootstrap regression | PASS |
| 4 | Public search and lesson pages hide sign-out | `src/giPublicAccess.test.js` | UI regression | PASS |
| 5 | `/` and `/login` both render the public lecture search experience | Local production preview with Playwright | End-to-end | PASS |

## Coverage and known gaps

The repository has no configured coverage script or threshold. The complete
Node test suite passed, and the changed routing behavior was also exercised in
a built production artifact. This change has not been deployed to CloudFront;
live-environment verification remains a post-deployment step.

## Merge evidence

- RED checkpoint: `8a376fe` (`test: add reproducer for public GI access`)
- GREEN: focused tests 4/4, complete client tests 289/289, production build
  successful, and local `/` plus `/login` browser checks successful.
