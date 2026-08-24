# Voice Cloning Project Handoff

Last updated: 2026-08-24

## Current Dev State

- Local branches `separate-containers-new` and `codex/staging-multi-user-scaling` share the
  unified application history. Application commit `2807e1c` is deployed to both Lambdas and
  clients; inference latency fix `331586a` is deployed to Dev and every staging GPU worker.
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
- `dea-voice-version2-v1` was repaired live: its old `leehseinlongnew` references were
  replaced by one primary and five auxiliary `dea-voice-version2` clips. S3 readback proved
  profile/config equality, six same-experiment paths, rank 1, and mode `auto`.
- Dev model selection now carries the selected primary clip's transcript/language through
  reference warming and repairs stale prompt metadata even when the paths did not change.
  Live `dea-voice-version2-v1` previously paired its selected `...340800...464000.wav` with
  “Good evening...COVID-19”; its manifest actually says “a lot of technology that involves
  patients' data.” The active profile and auto-managed rank-1 default config are repaired and
  match the manifest while retaining the same primary, five auxiliaries, and exact aux order.
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
- Final automated evidence: client 411/411 and Lambda 200/200. Browser verification with a
  real allowlisted Microsoft account remains pending.

## Current Staging State

- Model-aware coordination is implemented locally but not deployed: matching free slot ->
  demand-idle zero-work reassignment -> one-instance scale-out. New instances atomically claim
  the oldest pending voice before deep warm; only an empty/unavailable queue falls back to Dean.
  Runtime policies were reportedly attached directly, but provisioning is now blocked because
  deployment role `Liu_Teng_Yu_Intern2026` is denied `dynamodb:DescribeTable` on the registry.
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
- Staging Live Fast uses two normal takes and at most two catastrophic-babble reseeds.
  All five staging workers now run the unified quality/pronunciation/retry code, match hashes,
  and are healthy with DeanVoice plus both verifiers active. AMI `ami-09603b8ca5f8a228b` is
  available and launch template v31 is latest/default; a fresh v31 node completed production-shaped
  deep warm before becoming healthy. Authenticated first/second-turn timing remains pending.
- Staging inference ASG `vcs-staging-gpu-inference` has live min 1/max 192; desired 5 remains
  from the earlier baseline action. The over-aggressive 1->5 policy is corrected live:
  baseline and fleet alarms require 3/3 one-minute periods at 70%, baseline goes to two,
  and later steps add one. This prevents a short two-slot single-user burst from launching
  four extra GPUs, but it is not yet model-aware autoscaling.
  The 07:00/19:00 Singapore actions preserve min 1 without forcing desired. The fixed GPU
  schedule is 0-24. Lambda cannot directly manage ASG capacity under its current role.
- Staging learner analytics remains absent. Do not deploy dev analytics to staging.
- Full chunking is aligned at 240 characters. Full reuses warm medium ASR with strict beam/tail
  gates and no longer regenerates five times when ASR itself is unavailable. Staging's Dean
  profile and rank-1 defaults match Dev settings and retain identical references.
## Operating Rules

- Code repo/branch: `VoiceCloning` / `separate-containers-new`.
- AWS account/role: `329599637774` / `Liu_Teng_Yu_Intern2026`. Read user-level
  `VCS_AWS_*`, map them to process `AWS_*`, assume the role, and verify identity before writes.
  Never print or persist credentials or private URLs.
- `lambda/.env.deployment` is incomplete. The deploy script merges it into live Lambda
  variables; snapshot/read live configuration before any configuration update.
- Project memory is mirrored between the primary Obsidian folder and
  `docs/Voice Cloning Internship`; keep edited files byte-identical.
- GitHub push is blocked on this workstation by missing GitHub credentials.

## Next Session

1. Run a controlled Dev quality comparison using identical weights, reference set, inference
   settings, text, and seeds; vary selector/verifier behavior separately before reverting.
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
8. Browser-time first and second staging GI/Live Fast replies after the canonical-cache rollout;
   separate remaining OpenAI/WebSocket setup time from GPU synthesis time.
