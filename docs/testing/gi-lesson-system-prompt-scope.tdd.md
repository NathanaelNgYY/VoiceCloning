# GI Lesson System Prompt Scope — TDD Evidence

## Source

The user journeys and acceptance criteria were derived directly from the request to keep the
GI bleeding lesson assistant from answering unrelated questions such as weather.

## User journey

As a student using the GI bleeding lesson assistant, I want unrelated questions to be refused,
so that every answer stays within approved GI bleeding education and the lesson video.

## RED evidence

- Test: `client/src/lib/chatbotSystemPrompt.test.js`
- Command: `node --test src/lib/chatbotSystemPrompt.test.js`
- Result: failed because `GI_BLEEDING_SCOPE_REFUSAL` and
  `buildGiBleedingScopedSystemPrompt` did not exist.
- Checkpoint: `7dd4a6e test: add reproducer for GI lesson scope guard`

## GREEN evidence

- The complete GI prompt is now enclosed by a non-editable scope gate after the saved prompt,
  uploaded references, and lesson-video transcript have been assembled.
- The gate explicitly identifies weather and other general-purpose topics as out of scope,
  forbids answering any part of an unrelated request, and requires the exact refusal:
  `I can only help with GI bleeding education and this lesson video.`
- Command: `node --test`
- Result: 292 tests passed, 0 failed.
- Command: `npm run build:gi`
- Result: production GI build completed successfully.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|---|---|---|---|
| 1 | A custom prompt cannot replace the leading or trailing GI scope gate | `client/src/lib/chatbotSystemPrompt.test.js` | Unit | PASS | `node --test src/lib/chatbotSystemPrompt.test.js` |
| 2 | The gate names weather and other unrelated topics and forbids answering them | `client/src/lib/chatbotSystemPrompt.test.js` | Unit | PASS | Exact instruction assertions |
| 3 | The same exact refusal is present before and after the assembled prompt | `client/src/lib/chatbotSystemPrompt.test.js` | Unit | PASS | Refusal occurrence assertion |
| 4 | The client remains regression-free | `node --test` | Regression | PASS | 292 tests passed |
| 5 | The GI production bundle still compiles | `npm run build:gi` | Build | PASS | Vite build succeeded |

## Coverage and known gaps

`node --test --experimental-test-coverage src/lib/chatbotSystemPrompt.test.js` reported 100%
line coverage, 80% branch coverage, and 100% function coverage for
`client/src/lib/chatbotSystemPrompt.js`.

The live CloudFront conversation could not be exercised from the available browser session
because the deployed page presented Microsoft SSO. The local tests prove prompt assembly; a
post-deployment conversation check is still required to verify the hosted model's response.

`npm audit` reported nine pre-existing dependency findings (four high, four moderate, one low).
Dependency upgrades were not included because they are unrelated to the prompt change and one
recommended Vite remediation is breaking.
