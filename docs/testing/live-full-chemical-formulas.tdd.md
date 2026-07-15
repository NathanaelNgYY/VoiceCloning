# Live Full Chemical Formula Pronunciation — TDD Evidence

## Source

No external plan file was used. The journeys and guarantees below were derived from
the request to improve chemical pronunciation while limiting all new behavior to Live
Full, using `C6H12O6`, `(CH2O)n`, and `COOH` as the reported regressions.

## User journeys

- As a lecturer, I want compact formulas read consistently in Live Full so I do not
  need repeated text edits to obtain a usable take.
- As a Live Fast user, I want its established text path left unchanged so the Full
  accuracy improvement does not affect latency or output there.
- As a science-content author, I want only valid formula-shaped tokens expanded so
  ordinary acronyms and capitalized words are not rewritten accidentally.

## Task report

### RED

Command:

```text
node --test src/services/textPronunciation.test.js src/services/longTextInference.test.js
```

Result: **RED** — 41 passed, 2 failed. The unit target failed because
`prepareTextForFullSynthesis` did not exist, and the integration target showed Live
Full passing `C6H12O6` and `COOH` through unchanged.

Checkpoint: `427e6c3 test: add Live Full chemical formula pronunciation reproducers`

### GREEN

Commands:

```text
node --test src/services/textPronunciation.test.js src/services/longTextInference.test.js
node --test --test-name-pattern="chemical formulas" src/routes/inference.test.js
```

Results: **GREEN** — 52/52 focused service tests passed; the separate Live Fast route
guard passed 1/1 and confirmed compact formulas remain unchanged on that route.

Checkpoint: `3ecd063 fix: normalize chemical formulas for Live Full`

### Coverage

Command:

```text
node --test --experimental-test-coverage --test-coverage-include=src/services/textPronunciation.js src/services/textPronunciation.test.js
```

Result: **11/11 passed**. `textPronunciation.js` coverage was 99.77% lines, 82.61%
branches, and 95.45% functions.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Live Full reads `C6H12O6`, `(CH2O)n`, and `COOH` as explicit letters, numbers, and parentheses | `textPronunciation.test.js` | Unit | PASS |
| 2 | Mixed-case element symbols such as `NaCl` and formulas such as `H2O` are recognized | `textPronunciation.test.js` | Unit | PASS |
| 3 | Acronyms such as `ATP` and `NASA`, plus invalid element sequences such as `Xx2`, are not treated as formulas | `textPronunciation.test.js` | Unit | PASS |
| 4 | Tens, hundreds, large notation-style subscripts, and numeric group counts are deterministic | `textPronunciation.test.js` | Unit | PASS |
| 5 | Formula expansion occurs before Live Full chunk synthesis | `longTextInference.test.js` | Integration | PASS |
| 6 | Live Fast receives compact formulas unchanged by the new Full-only behavior | `inference.test.js` | Route regression | PASS |

## Verification and known gaps

- JavaScript syntax checks passed for all modified files.
- The current full inference-worker suite passes 198/198 tests.
- `npm audit --omit=dev` reports one existing moderate `qs` denial-of-service advisory.
  Dependency upgrades were intentionally left outside this pronunciation change.
- Audio was not rendered locally because `GPT_SOVITS_ROOT`, the GPU model, and
  production reference audio are not available in this workspace. A production ear
  check remains necessary after deployment.

## Follow-up: separated letter-and-number reading

Production listening showed that the original whitespace-only expansion could still
blend letter-name homophones in the cloned voice. The clarified requirement is a
literal letter-and-number reading—not element names—with short boundaries between
tokens. For example, `C6H12O6` must be sent as
`cee, six, aitch, twelve, oh, six` on Live Full.

### Follow-up RED

Command:

```text
node --test src/services/textPronunciation.test.js src/services/longTextInference.test.js
```

Result: **RED** — 61 passed, 4 failed. Both the unit and Live Full integration targets
showed the old whitespace-only `cee six aitch twelve oh six` rendering. Live Fast's
unchanged-formula guard remained green.

Checkpoints:

- `0c948cf test: reproduce fragile Live Full formula spelling`
- `850dacf test: require separated formula letters in Live Full`

### Follow-up GREEN

Command:

```text
node --test src/services/textPronunciation.test.js src/services/longTextInference.test.js
```

Result: **GREEN** — 65/65 passed. The Live Full helper and chunking path now preserve
the requested letter-and-number reading with comma boundaries; the shared Live Fast
normalizer still passes formulas through unchanged.

Full-suite and coverage verification:

```text
node --test
node --check src/services/textPronunciation.js
node --test --experimental-test-coverage --test-coverage-include=src/services/textPronunciation.js src/services/textPronunciation.test.js
```

Results: **198/198 full-suite tests passed** and **12/12 coverage-target tests passed**.
`textPronunciation.js` coverage was 99.77% lines, 81.94% branches, and 95.83%
functions.

## Follow-up: natural symbol/subscript grouping

Listening showed that comma-separating every token sounded robotic. The refined
contract keeps a symbol and its subscript together and uses a boundary only between
counted groups: `C6H12O6` becomes `cee six, aitch twelve, oh six`. Unsubscripted runs
such as `COOH` become `cee oh oh aitch` without inserted pauses. Live Fast remains
unchanged.

### Grouping RED

Command:

```text
node --test src/services/textPronunciation.test.js src/services/longTextInference.test.js
```

Result: **RED** — 61 passed, 4 failed. The output still used the over-separated
`cee, six, aitch, twelve, oh, six` form.

Checkpoint: `b91b686 test: reproduce over-paused Live Full formulas`

### Grouping GREEN

Command:

```text
node --test src/services/textPronunciation.test.js src/services/longTextInference.test.js
```

Result: **GREEN** — 65/65 passed. Unit and Live Full chunking tests now enforce
symbol/subscript grouping, continuous unsubscripted formulas, and unchanged Live Fast
behavior.

Final verification: the full inference-worker suite passed **198/198** tests. The
targeted formatter coverage run passed **12/12** tests with 99.77% line, 82.89% branch,
and 96.30% function coverage.
