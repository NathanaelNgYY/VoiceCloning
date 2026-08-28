# Voice Cloning Project Handoff

Last updated: 2026-08-28

## Current Dev State

- Both active remote branches contain merged application commit `b3756db`. Dev and Staging main
  Lambdas have exact code SHA `3CbOy8HC…`, deployed from parent `5571ae6`; the later published-name
  and failed-scale-claim cleanup merge still needs deployment after AWS credentials are refreshed.
- Dev contains staging application behavior plus dev-only learner analytics and voice-quality work.
  Original GPU `i-03f258d470a2fa73f` remains activity-managed with a 30-minute idle stop. Separate
  comparison GPU `i-0048470294e4ec518` is manual-only. Dev now uses the shared model coordinator in
  `routing-only` mode across those exact IDs: no ASG/start/stop action, with simulated Staging scale
  messages under pressure. Both GPUs were started for a pending live routing test; stop the manual
  one afterward. A dedicated ALB path pins idle checks to the original GPU only.
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
- Current evidence includes client 485/485, Lambda 298/298, focused routing/queue 91/91, and deployed
  bundle/Lambda readback. A Dev preflight with both GPUs off returned `DEV_CAPACITY_SIMULATED`; the
  new coordinator has not yet proved both running workers because AWS credentials expired before SSM.

## Current Staging State

- Faculty's empty-selection and hidden-advanced-settings fixes are deployed; its bundle contains no
  advanced-settings label. `gi-bleeding -> deanvoice-v1` is byte-equivalent through both public APIs.
  API 401 still blocks a real lecturer-browser publish proof.
- Staging faculty is the only authoring surface. Publishing now copies the selected profile, GPT/
  SoVITS weights, primary/aux references, then the category into Dev; current `deanvoice-v1` was
  backfilled and all nine artifacts matched by size/ETag before the Dev category changed.
- Fixed staging GPU `i-0f0da8be59367f7a8` runs `30234eb`; all three services restarted and passed
  the applicable liveness/readiness checks. Prior tracked and colliding untracked files on fixed Dev,
  fixed staging, and updated ASG workers remain recoverable in named server-side stashes.
- Lecture-click capacity routing is live: matching real free slot -> immediate idle-worker
  reassignment -> scale-out only when every eligible worker is active, queued, draining, starting,
  or unavailable. A positive reassignment window remains configurable for explicit events.
  A concurrent canary returned two RIFF WAVs, showed usable `BUSY_STARTING`, atomically raised
  desired 1->2 exactly once, deeply warmed the requested Dean pool, and scaled back to one.
  Launch-template v39/default uses tagged AMI `ami-0cf96ffb91690b17c`. Current ASG worker
  `i-08203eed43c173e96` is healthy, READY for `deanvoice-v1`, idle, and has no queue. ASG is min/desired 1,
  max 192; daily actions now preserve min 1 and leave desired unset. Authenticated UI remains unverified.
- TTS and Faculty model selection now use the same coordinator preflight as lecture selection instead
  of random ALB preparation. Live Fast and initial Full admission are coordinated. If every resident
  exact-model slot is occupied, work enters the bounded worker priority/FIFO queue while Staging asks
  for overflow capacity. Follow-up Full session edits remain session-aware direct operations.
- Deep warm and request-time enforcement share one canonical hashed model-cache path and the
  same production model snapshot. Commit `5634303` is live on all five serving workers.
- The shared deployed code makes environment differences explicit: Dev alone configures its learner table
  and routing-only fixed-instance coordinator; Staging alone owns ASG autoscaling;
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
- Staging inference ASG `vcs-staging-gpu-inference` has min 1/max 192 and two slots per GPU. Legacy
  ALB actions are telemetry-only; coordinator idleness plus `NewestInstance` drives scale-in.
  Readback shows desired 1 and one healthy idle worker; a
  full untouched 15-minute alarm-trigger timing canary remains pending. The 07:00/19:00
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
  were read back at `b3756db`; deployed package parity was checked before that final merge.

## Next Session

1. Refresh user-level `VCS_AWS_*`, inspect both running Dev workers' coordinator auth/readiness, run
   an exact-model two-worker routing/queue canary, then stop manual GPU `i-0048470294e4ec518`.
2. Have an account administrator delete orphaned temporary snapshot `snap-08ec74499a13176f7`;
   the temporary AMI was deregistered but this role lacks `ec2:DeleteSnapshot`.
3. Verify Dev GI sign-in, Dean text/audio, `/admin`, mobile layout, and the voice-config lifecycle.
4. Run a representative clean/noisy Dev training job; compare reference sets and cloned audio blind.
5. Calibrate the phoneme verifier on labeled training/held-out crops before changing thresholds.
6. Prewarm known Staging bursts; reactive scaling is not immediate event safety.
7. Browser-refresh active Full/Queue requests and prove the same S3 session resumes without resubmit.
