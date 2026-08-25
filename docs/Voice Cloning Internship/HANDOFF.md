# Voice Cloning Project Handoff

Last updated: 2026-08-25

## Current Dev State

- Remote branches `separate-containers-new` and `codex/staging-multi-user-scaling` both point to
  unified commit `30234eb`. Dev/staging main Lambdas have the exact same package SHA; all Dev and
  staging client targets were rebuilt from that tree. Fixed Dev GPU `i-03f258d470a2fa73f` also
  runs `30234eb`; all three worker services and their health/readiness probes passed.
- Dev contains staging application behavior plus dev-only learner analytics and voice-quality work.
  Dev remains fixed-instance/on-demand: `GPU_SCHEDULE_ENABLED=false`, no inference ASG, and fixed
  GPU `i-03f258d470a2fa73f` belongs to no ASG.
- Dev GI uses the centered D25 staging login, not the faculty split-panel design. The SPA shell
  now returns `no-store, must-revalidate, no-cache`, preventing a first navigation from reusing
  the deleted split-layout bundle.
- Model load waits for the selected model's rank-1 config. Curated/user-reordered rank 1 is
  authoritative. Untouched or legacy cross-model `default` rank 1 runs scored `Use best`
  only on the experiment derived from the selected weights, then stores the same references
  in default config and voice profile. The Load button is inference-session-only.
- Training now filters acoustically bad or implausibly transcribed clips before features.
  Reference selection uses measured metrics and diversity. The shadow phoneme verifier has
  monotonic per-phone CTC evidence and a weakest-phone floor. Real listening comparison and
  held-out phoneme calibration are still required; tests do not prove audible improvement.
  A user comparison reported worse Dev pronunciation/gibberish, but used Dev
  `dea-voice-version2-v1` versus staging `deanvoice-v1`, so the cause is not isolated.
  The same quality code is now on staging by explicit user decision, but remains audibly unvalidated.
- A pending Full/Full Queue session is persisted per browser tab after the backend accepts it.
  Refresh reconnects its SSE session instead of submitting another GPU job, restores text and
  progress, and warns before navigation. A synchronous lock also blocks duplicate clicks.
  This is not cross-tab/device backend idempotency.
- Final automated evidence for the unified tree: client 436/436, Lambda 275/275, GPU worker
  23/23, inference worker 258/258, live gateway 180/180, four client builds, plus 15/15 tests
  for the later white-screen merge. Real authenticated browser verification remains pending.

## Current Staging State

- The 2026-08-25 faculty deployment had overwritten staging's coordinator-aware main Lambda and
  lecture client. Unified commit `30234eb` restores faculty publishing plus model coordination;
  the main Lambda now matches Dev's package SHA, the coordinator was redeployed, and public Dev/
  staging assets expose capacity, stock-voice, and crash-boundary code. Staging currently publishes
  cloned `deanvoice-v1`; Dev has no deployed category object and uses its legacy/build fallback.
- Fixed staging GPU `i-0f0da8be59367f7a8` runs `30234eb`; all three services restarted and passed
  the applicable liveness/readiness checks. Prior tracked and colliding untracked files on fixed Dev,
  fixed staging, and updated ASG workers remain recoverable in named server-side stashes.
- Lecture-click capacity preparation and model-aware routing are live on staging: matching slot ->
  five-minute demand-idle reassignment -> per-model scale-out, with two admitted slots per GPU.
  A concurrent canary returned two RIFF WAVs, showed usable `BUSY_STARTING`, atomically raised
  desired 1->2 exactly once, deeply warmed the requested Dean pool, and scaled back to one.
  Launch-template v39/default uses tagged AMI `ami-0cf96ffb91690b17c`. Fresh v39 instance
  `i-0c92f3224029284ee` booted at `30234eb` with zero tracked/runtime drift and reached inference
  plus gateway readiness. ASG health grace is 1,200s; final state is min/desired 1, max 192, ELB
  health, and one healthy unprotected v39 worker. Authenticated browser UI remains unverified.
- Deep warm and request-time enforcement share one canonical hashed model-cache path and the
  same production model snapshot. Commit `5634303` is live on all five serving workers.
- The shared deployed code makes environment differences explicit: Dev alone configures its learner table;
  staging alone sets `GPU_STATUS_READINESS_TARGET=inference`; Dev shows advanced TTS controls and
  staging hides them through `VITE_SHOW_ADVANCED_SETTINGS`. No quality/retry fork remains locally.
- Live Fast now reports GPU readiness from the routed inference fleet `/models` endpoint,
  not the fixed training worker. Dev retains its fixed-worker probe. The hidden-tab Full
  output path accepts a downloaded RIFF/WAVE without waiting for throttled media metadata.
  Lambda and Live Fast asset `index-MsbyZc5S.js` are deployed; public status/model/inference
  readback passed. A real background-tab browser reproduction is still pending.
- Durable events proved one staging Full request took 490.19 seconds because lazy `large-v3`
  verification timed out, then Full generated ten takes across two chunks. Full now uses warm
  medium ASR with the existing strict beam/timing/tail gates and stops after one usable take if
  ASR itself is unavailable. The same text completed directly on staging in 18 seconds with five takes.
- A prior exact Full request completed a valid 929,324-byte WAV in 460.03 seconds. Its first
  chunk took 451.95 seconds and six attempts after sentence fallback; chunk 1 took 7.68 seconds.
  Staging origins were missing from shared-bucket CORS and terminal sessions could remain
  marked local on the originating worker, causing the false finalization error after refresh.
  CORS is corrected and terminal SSE state is cleared so reconnect uses durable S3 replay.
- Faculty SSO is deployed at `faculty.lkcmedicine.org`: Microsoft sign-in admits only
  staff/associate domains and writes to `vcs-staging-lecturers`. Lectures remains separate.
  A real staff sign-in and lecturer-table write are still unverified.
- Staging inference ASG `vcs-staging-gpu-inference` has min 1/max 192 and two slots per GPU.
  Legacy ALB occupancy actions are telemetry-only; scale-in uses coordinator Lambda invocation
  idleness. Alarm/action readback and a controlled protected scale-down passed; a full untouched
  15-minute alarm-trigger timing canary remains pending. Final desired is 1. The 07:00/19:00
  Singapore actions preserve min 1 without a per-voice minimum.
- Staging learner analytics remains absent. Do not deploy dev analytics to staging.
- Full chunking is aligned at 240 characters. Full reuses warm medium ASR with strict beam/tail
  gates and no longer regenerates five times when ASR itself is unavailable. Staging's Dean
  profile and rank-1 defaults match Dev settings and retain identical references.
## Operating Rules

- Code repo branches: Dev `separate-containers-new`; staging
  `codex/staging-multi-user-scaling`. Keep both pointers on the same reviewed commit; activate
  environment differences through deployment configuration, not divergent application trees.
- AWS account/role: `329599637774` / `Liu_Teng_Yu_Intern2026`. Read user-level
  `VCS_AWS_*`, map them to process `AWS_*`, assume the role, and verify identity before writes.
  Never print or persist credentials or private URLs.
- `lambda/.env.deployment` is incomplete. The deploy script merges it into live Lambda
  variables; snapshot/read live configuration before any configuration update.
- Project memory is mirrored between the primary Obsidian folder and
  `docs/Voice Cloning Internship`; keep edited files byte-identical.
- GitHub pushes work with the configured credential manager override; both active remote pointers
  were read back at `21596bf` before the AWS credential expiry.

## Next Session

1. Refresh user-level `VCS_AWS_*`; deploy/read back the running Dev worker, require fixed staging
   inference readiness, and compare the active ASG worker/launch-image runtime to `21596bf`.
2. Open Dev GI in a new tab with an allowlisted account and confirm the first render (without
   refresh) is D25, then verify sign-in, Dean text/audio, `/admin`, and mobile layout.
3. Exercise the new voice config lifecycle: untouched default reselects only same-model clips;
   Update/reorder pins rank 1; Load previews a config without rewriting the profile. Listen to
   the repaired Dev primary and confirm the transcript displayed after a fresh model load.
4. Run a representative clean/noisy Dev training job and inspect `clip-scores.json` and
   `training-quality-report.json`; compare old/new reference sets and cloned audio blind.
5. Collect labeled phoneme crops, calibrate on a training split, and validate on held-out audio
   before changing verifier thresholds.
6. For staging event work, follow `docs/staging-architecture.md` and `TODO.md`; prewarm known
   bursts because reactive scaling is too slow for sudden arrivals.
7. Browser-refresh an active Full and Full Queue request on staging and Dev, and prove that
   the same session ID resumes with no second S3 session. Then instrument first-chunk verifier
   and model stages; do not change the 3→5 policy without a controlled quality comparison.
