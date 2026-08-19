# Voice Cloning Project Handoff

Last updated: 2026-08-18

- Faculty SSO is **deployed** to staging (2026-08-18): `faculty.lkcmedicine.org` now requires
  Microsoft sign-in and admits only staff/associate domains, with faculty rows isolated to the
  new `vcs-staging-lecturers` table. No administrator was needed after all — `CreateTable` is
  gated on the `CreatorId=INTERNS2026` tag rather than absent, and the gateway's write grant
  went in as a DynamoDB *resource-based* policy because `iam:*` is denied. The original plan
  also missed that the faculty distribution had no `/api/live/session/*` cache behavior, so
  sign-in would have 404'd at the Lambda; it was copied from lectures. Automated gates pass
  (gateway 180/180, Lambda 139/139, client 355/355; both hosts 200; both sign-in routes 401
  unauthenticated). **The one thing still unproven is a real staff sign-in and an actual
  lecturer-table write** — see `docs/staging-architecture.md` and `TODO.md`.

- Staging Live Fast is deployed with two normal takes and at most two additional
  catastrophic-babble reseeds. Duplicate words now reduce fallback candidate scores.
  AMI `ami-0b05ebda8d96a924f` is available and staging LT v27 is default; two v27
  instances passed strict rollout gates and a faculty-host request returned HTTP 200 RIFF.
- Staging inference ASG matches the fixed GPU's 24-hour availability: live
  min/desired is currently 1/2. The retained 07:00 and 19:00 Singapore actions set
  min 1/max 192 with desired unset, so neither resets a busy autoscaled fleet.
  Direct Lambda-to-ASG coupling remains unavailable because the Lambda role lacks
  Auto Scaling permission; matching scheduled actions preserve the continuous floor.
  Live readback found the fixed GPU running and its Lambda schedule enabled, 0-24.
- The chatbot-text build `assets/index-BJPFG8hT.js` is deployed on CloudFront E38.
  When Lambda reports `LIVE_DEMO_LOCKOUT=true`, only the distribution's two exact
  faculty hostnames bypass the lock. The live flag was not enabled during verification.
- Standalone builder `i-0f6c399842bd8cc38` was shut down after AMI creation; an
  administrator must terminate it because the internship role is denied that action.

## Staging Whisper incident (2026-08-13)

- Work is on local branch `codex/staging-whisper-fix` at `c4256dc`, based on
  `origin/codex/staging-multi-user-scaling`, not the deliberately divergent dev branch.
  GitHub push is blocked because this workstation has no GitHub credential.
- Whisper was broken on LT v24: the medium model needed 215.77 seconds to load but
  startup was killed at 120 seconds. The default is now 360 seconds. The staging AMI
  also lacked the phoneme runtime/full model; both are provisioned and cached.
- AMI `ami-0538dcd9374f9ecdb` is available. LT v26 is default and includes that AMI,
  active-profile warming, a single boot warm, and repaired public-prime auth.
- Fresh v26 instance `i-049271d608c44b5e3` completed one 616-second deep warm with
  no worker restart; Whisper-medium and the phoneme model were active, both services
  were running, and the optimized target was healthy. Cloud-init finished without
  errors and both public-prime requests returned HTTP 200 RIFF on their first attempt.
- Current live baseline is ASG min/desired 1/1 on LT v26; both occupancy alarm actions
  are enabled. Standalone canary `i-0e4ef8844a120d069` was previously stopped after a
  verified instance-initiated shutdown; an administrator must terminate it permanently.
## Needs Action

- Dev and staging branches have diverged on purpose. Staging carries the deployable
  chatbot instructions (`/api/chatbot/system-prompt` + the panel's Deploy button); dev
  carries learner analytics. See DECISIONS.md "Branch Divergence: Dev vs Staging"
  before merging either way — it also lists divergence that lives only in runtime
  configuration and so never appears in a branch diff.
- Staging work as of 2026-08-13 was handed over separately. Its state, open items, and
  two corrected assumptions about GPU warming are in the **staging branch's**
  `HANDOFF.md` under "Staging Handover"; this file stays dev-focused.

- Hard-refresh dev and verify the allowlisted supervisor sees `Admin analytics`, while an
  ordinary student does not. The authorization change, requested OID, Lambda, client bundle,
  and completed CloudFront invalidation were independently read back on 2026-08-13.

- Hard-refresh dev and verify Questions includes retained pre-analytics transcript turns, one new
  ordinary question adds `concept_question` evidence, and a repeated question adds only its independent bonus.
- The lesson-summary redundant-write skip in `lambda/analytics/learnerStore.js` is deployed to
  dev (`30729f2`). Still to confirm on a live signed-in learner: a repeated batch that changes
  nothing should leave the `#SUMMARY` item's `updatedAt` untouched, while a batch that adds
  evidence still moves it.
- The dev Lambda environment was wiped in error on 2026-08-10 and restored from
  `lambda/.env.deployment` plus `GPU_SCHEDULE_ENABLED=false` (21 keys, verified live).
  `SUPERVISOR_OIDS` was not set beforehand, so nothing was lost: supervisor access runs
  through the `SUPERVISOR_APP_ROLE` Entra app role, which is restored. If dev ever had
  `VOICE_PROFILE_INTERNAL_AUTH_HEADER_NAME`/`_VALUE`, `DEMO_CLOUDFRONT_HOST`, or
  `LIVE_DEMO_LOCKOUT` set, they would need re-adding; the code reads them and they are not
  in `.env.deployment`.
- `lambda/.env.deployment` is not a complete description of the Lambda environment. The
  deploy script merges it into the live variables, so anything absent survives only as live
  state. Snapshot the environment to a file before any `update-function-configuration`.

## Start Here
- Scope: dev parity plus confirmed staging event action; repo/branch `VoiceCloning` / `separate-containers-new`.
- Dev host is at `4c8911a`; local checkout has later analytics/UI/auth commits. Preserve the host's
  unrelated deleted verifier file and archives; do not clean them up.
- Read this file, `docs/staging-architecture.md`, `TODO.md`, and `scripts/deploy.config.json` first.
- Never print or save credentials, tokens, private URLs, or secret values.
- Dev per-user learner analytics is deployed to the non-staging Lambda, fixed dev gateway,
  dev chatbot CloudFront/S3 target, and `vcs-dev-transcripts`. PITR is enabled and the
  gateway instance role's `PutItem` was proven with an expiring probe.
- Dev support decays per logarithmic event rank on a 14-day half-life inside a 30-day window;
  repeated behaviour has diminishing returns and no hard score cap. Passive
  actions still infer nothing. Thresholds recalibrated so the support states match what the
  earlier linear scale produced. Live on dev.
- The chatbot receives concept and support state only. Signal names, scores, and counts stay
  in analytics and never reach the model.
- Learner analytics remains dev-only. GI fixes Dean by ID in both clients/Lambdas;
  no staging analytics, scaling, gateway, TTS, or training resource changed.

## Deployed Dev State
- Dev and staging Live Fast TTS show advanced settings from commit `85303e2`; only
  those clients changed. Other dev CloudFront configs retain staging parity.
- Dev Lambda includes the `4c8911a` analytics routes, 512 MB, 120 seconds, and a 30-second retry
  budget. `GPU_SCHEDULE_ENABLED=false`; no inference ASG name is configured.
- Fixed GPU `VoiClo-GPU-Seoul` at `4c8911a` has two synthesis slots, the 100-item/25-second queue, and boot warming.
- Dev has no ASG, scaling alarms, or ASG scheduled actions. The enabled five-minute
  EventBridge rule invokes idle-check only; activity requests own GPU startup.
- Dev GI requires Microsoft sign-in, records identified lesson/video evidence, retrieves
  per-user teaching guidance, and exposes `/admin` (`/supervisor` redirects). CloudFront `EYZ4NLNGITY7T`
  routes `/api/live/session/*` to the dev ALB and general `/api/*` to the dev Lambda.
  Dev bundle `assets/index-weH0TlqD.js` adds the home Admin button and responsive animated vertical concept graph,
  clearer evidence detail, and prefetched S3 Events with action counts and newest-first 10-row paging. New batches write only to the per-user
  lake. The retained 44-object global archive is no longer read at request time; 32 user batches were
  indexed and raw evidence replayed. Questions reads retained DynamoDB turns only; S3 remains the Events lake.
  Endoscopy read-back is 16 events/3.27. Signed-in visual timing remains unverified.
  Normal dev TTS/Training/Dean stay public. Ranking is supervisor-only; chatbot guidance applies only the concept matching the current question.
  Both current developers are dev supervisors through the Lambda's verified Entra object-ID
  allowlist; this does not require staff email or assign a DynamoDB role. Staging is unchanged.

## Current AWS Operating State
- Region/account/role: Seoul / `329599637774` /
  `Liu_Teng_Yu_Intern2026`; verify the assumed identity before every mutation.
- ASG `vcs-staging-gpu-inference`: continuous min/desired 1, max 192; launch-template
  `lt-07728350a25e691a4` defaults to v26; two synthesis slots per `g6.xlarge`.
- Optimized target group is `vcs-stg-opt-3103`. The separate live gateway is running
  and healthy in `vcs-staging-tg-3002`; do not stop it during event preparation.
- The fixed GPU now has 24-hour availability. Matching ASG actions preserve min 1
  without setting desired at 07:00 or 19:00 Singapore. Exact manual-state coupling is deployed
  but disabled pending Lambda-role Auto Scaling permissions.

## Autoscaling and Readiness

- Occupancy is occupied slots / `(healthy GPUs * 2)` on one-minute data. Below five healthy GPUs,
  one >=70% sample sets capacity five; at five or more it adds ten. Scale-in removes one after
  15 quiet minutes, floor one; `FILL(requests,0)` fixed missing-data scale-in.
- Reactive launch is too slow for sudden events: a 07:00 73% sample alarmed 07:03:48, all targets
  were healthy 07:09:27, and public primes finished 07:11:30. Prewarm known bursts.
- Local deep warm is exact-target; public prime is not because ALB may route elsewhere. Admit only
  after desired/InService/healthy coverage plus a fresh public-RIFF marker. A dedicated warm target
  group remains future work. The SSM polling fix prevents false failures, not slow warming.

## Verified Test Evidence

- Two slots passed 50/50 deep warm; three slots failed 39/50 and was rejected.
- Browser-equivalent three-turn runs: 50 GPU/100 users 100/100; 50/150 150/150;
  primed 60/100 and 60/150 both 100%. Evening repeats were 100/100, 149/150, 100/100,
  and 150/150. These prove completion, not a clean fleet-size latency comparison.
- Turn-one first-audio p50/p95: 50/100 12.72/13.98s; 50/150 7.15/14.61s;
  60/100 13.33/22.40s; 60/150 7.61/14.20s. Answer length was uncontrolled.
- Early-sentence browser smoke was 12.42s cold and 3.26/2.96s warm. Eager 512 MB Live init
  cut a GPU-free first invocation from 4.618s to 15.71ms; 100/150-user reruns passed.

## Event Procedure

1. Refresh credentials outside chat, map them to `AWS_*`, assume the role, and verify
   account/region without printing secrets.
2. Check Git status/log and live-describe the ASG, LT default, scheduled actions,
   alarm actions, target health, quotas, and live gateway.
3. Run `scripts/ensure-staging-live-gateway.ps1 -Apply`.
4. After scheduled launch, run
   `scripts/wait-staging-event-ready.ps1 -ExpectedCapacity 50`.
5. Admit users only after the strict gate succeeds and a public TTS RIFF smoke passes.
6. Test the real flow with `node scripts/load-test-staging-chatbot.mjs 100`; use
   `scripts/load-test-staging-tts.mjs` only for controlled fixed-text capacity tests.

## Next Session Priorities and Blockers

- First hard-refresh dev GI and confirm text plus Dean audio. Exercise rewind, long pause, transcript
  review, and similar questions across timestamps; verify DynamoDB and `/admin`. The Entra
  `Supervisor` role is not known assigned. Capture failures and inspect dev logs only.
- Keep alias/provisioned concurrency as a future option only. The next latency targets
  are 150-user admission retries and rare outside-Lambda transit outliers.
- For faster reactive scaling, build a real fleet-wide high-resolution occupancy
  publisher every 10 seconds and test three consecutive samples. Merely changing the
  current alarm period does not create 10-second source data.
- Do not enable three slots, FSR, a longer CloudFront timeout, or Lambda memory changes
  without a controlled benchmark. Current evidence does not justify them as baseline.
- Admin work: grant scoped Lambda ASG permissions; deregister/terminate the two stopped
  validators listed in `TODO.md`; consider a second private subnet/AZ.
