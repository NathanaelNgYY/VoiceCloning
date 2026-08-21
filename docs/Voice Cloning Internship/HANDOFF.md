# Voice Cloning Project Handoff

Last updated: 2026-08-21

## Current Dev State

- Local branches `separate-containers-new` and `codex/staging-multi-user-scaling` share the
  unified application history. Commit `2807e1c` was deployed to both Lambdas, clients, and fixed
  GPU services; the remaining deployment-config documentation commit is local only.
- Dev contains staging application behavior plus dev-only learner analytics and voice-quality work.
  Dev remains fixed-instance/on-demand: `GPU_SCHEDULE_ENABLED=false`, no inference ASG, and fixed
  GPU `i-03f258d470a2fa73f` belongs to no ASG.
- Dev GI uses the centered D25 staging login, not the faculty split-panel design. The SPA shell
  now returns `no-store, must-revalidate, no-cache`, preventing a first navigation from reusing
  the deleted split-layout bundle.
- Final deployed Dev client assets are Training `index-Cc6cF0sB.js`, Live Fast
  `index-D0VsmmM8.js`, and GI `index-B9gUM8Zv.js`. Their CloudFront invalidations were created;
  all three public hosts returned HTTP 200 with those assets and the expected cache header.
- The inference-config header now truncates long filenames without moving Save new outside
  its card. Background model discovery/load uses silent optional auth because those endpoints
  are public; protected analytics/synthesis still requires a token. A `pageshow` guard reloads
  browser-history snapshots so an obsolete faculty-style login is not restored.
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

- The shared deployed code makes environment differences explicit: Dev alone configures its learner table;
  staging alone sets `GPU_STATUS_READINESS_TARGET=inference`; Dev shows advanced TTS controls and
  staging hides them through `VITE_SHOW_ADVANCED_SETTINGS`. No quality/retry fork remains locally.
- Live Fast now reports GPU readiness from the routed inference fleet `/models` endpoint,
  not the fixed training worker. Dev retains its fixed-worker probe. The hidden-tab Full
  output path accepts a downloaded RIFF/WAVE without waiting for throttled media metadata.
  Lambda and Live Fast asset `index-BcbvrzpN.js` are deployed; public status/model/inference
  readback passed. A real background-tab browser reproduction is still pending.
- An exact staging Full request took 429.11 seconds; its first chunk consumed five attempts
  and 312.86 seconds. A refresh created a second identical 401.63-second session before the
  refresh-reconnect fix. The recorded ASG scale-out started about 34 minutes before this job,
  so the refresh did not cause that scale-out. First-chunk stage profiling remains pending.
- A later exact Full request completed a valid 929,324-byte WAV in 460.03 seconds. Its first
  chunk took 451.95 seconds and six attempts after sentence fallback; chunk 1 took 7.68 seconds.
  Staging origins were missing from shared-bucket CORS and terminal sessions could remain
  marked local on the originating worker, causing the false finalization error after refresh.
  CORS is corrected and terminal SSE state is cleared so reconnect uses durable S3 replay.
- Faculty SSO is deployed at `faculty.lkcmedicine.org`: Microsoft sign-in admits only
  staff/associate domains and writes to `vcs-staging-lecturers`. Lectures remains separate.
  A real staff sign-in and lecturer-table write are still unverified.
- Staging Live Fast uses two normal takes and at most two catastrophic-babble reseeds.
  All five staging workers now run the unified quality/pronunciation/retry code, match hashes,
  and are healthy with DeanVoice plus both verifiers active. A direct worker TTS returned a valid
  WAV in 2.28 seconds. AMI `ami-09e94f91882b29b91` is available and staging launch template
  v29 is default. Forced canary scale-out was denied, so a fresh v29 boot remains unverified.
- Staging inference ASG `vcs-staging-gpu-inference` has live min 1/max 192; desired 5 was
  observed after the 2026-08-21 baseline occupancy alarm scaled it from 1 to 5.
  The 07:00/19:00 Singapore actions preserve min 1 without forcing desired. The fixed GPU
  schedule is 0-24. Lambda cannot directly manage ASG capacity under its current role.
- Staging learner analytics remains absent. Do not deploy dev analytics to staging.
- Stopped builder `i-0f6c399842bd8cc38` and verifier canary `i-0e4ef8844a120d069`
  require administrator termination.

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
8. Verify the next naturally launched staging instance boots LT v28, loads DeanVoice, and
   passes readiness; do not recycle the healthy fleet solely for this check.
9. Verify the next natural staging scale-out boots LT v29 / AMI `ami-09e94f91882b29b91`, loads
   DeanVoice and both verifiers, and carries the merged inference file hashes.
