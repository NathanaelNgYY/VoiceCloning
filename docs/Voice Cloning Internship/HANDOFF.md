# Voice Cloning Project Handoff

Last updated: 2026-08-07

## Start Here

- Scope: dev parity plus confirmed staging event action; repo/branch `VoiceCloning` / `separate-containers-new`.
- Dev host is at `4c8911a`; local checkout has later analytics/UI/auth commits. Preserve the host's
  unrelated deleted verifier file and archives; do not clean them up.
- Read this file, `docs/staging-architecture.md`, `TODO.md`, and `scripts/deploy.config.json` first.
- Never print or save credentials, tokens, private URLs, or secret values.
- Dev per-user learner analytics is deployed to the non-staging Lambda, fixed dev gateway,
  dev chatbot CloudFront/S3 target, and `vcs-dev-transcripts`. PITR is enabled and the
  gateway instance role's `PutItem` was proven with an expiring probe.
- Learner analytics remains dev-only. GI fixes Dean by ID in both clients/Lambdas;
  no staging analytics, scaling, gateway, TTS, or training resource changed.

## Deployed Dev State

- Dev and staging Live Fast TTS show advanced settings from commit `85303e2`; only
  those clients changed. Other dev CloudFront configs retain staging parity.
- Dev Lambda includes the `4c8911a` authenticated analytics/learner routes, 512 MB, 120 seconds, and a 30-second inference
  retry budget. `GPU_SCHEDULE_ENABLED=false` and no inference ASG name is configured.
- Fixed GPU `VoiClo-GPU-Seoul` checkout is `4c8911a`; inference
  has two synthesis slots, the 100-item/25-second queue, and boot warming enabled.
- Dev has no ASG, scaling alarms, or ASG scheduled actions. The enabled five-minute
  EventBridge rule invokes idle-check only; activity requests own GPU startup.
- Dev GI requires Microsoft sign-in, records identified lesson/video evidence, retrieves
  per-user teaching guidance, and exposes `/supervisor`. CloudFront `EYZ4NLNGITY7T`
  routes `/api/live/session/*` to the dev ALB and general `/api/*` to the dev Lambda.
  Dev bundle `assets/index-6qG3aJlL.js` fixes `deanvoice-v1`, adds supervisor analytics, surfaces
  setup failures, and carries Entra REST auth outside SigV4's `Authorization`. Staging is unchanged.
  Normal dev TTS/Training/Dean stay public. Repeats score 1.25.

## Current AWS Operating State

- Region/account/role: Seoul / `329599637774` /
  `Liu_Teng_Yu_Intern2026`; verify the assumed identity before every mutation.
- ASG `vcs-staging-gpu-inference`: daytime min/desired 1, off-hours 0, max 192; launch-template
  `lt-07728350a25e691a4` defaults to v20; two synthesis slots per `g6.xlarge`.
- Optimized target group is `vcs-stg-opt-3103`. The separate live gateway is running
  and healthy in `vcs-staging-tg-3002`; do not stop it during event preparation.
- `GPU_SCHEDULE_ENABLED=true` with a live 07:00-19:00 Singapore fixed-GPU window.
  Matching verified ASG actions set 1 at 07:00 and 0 at 19:00. Exact manual-state
  coupling is deployed but disabled pending Lambda-role Auto Scaling permissions.

## Autoscaling and Readiness

- Scaling works outside event mode. Occupancy is occupied slots divided by
  `(healthy GPUs * 2)`, sampled in one-minute CloudWatch data.
- Below five healthy GPUs, one sample at or above 70% sets desired capacity to five.
  At five or more, one sample at or above 70% adds ten; later samples re-evaluate.
- Scale-in removes one GPU after 15 no-traffic minutes, with floor one.
- Fixed quiet scale-in: a missing-data alarm had no numeric value for Step Scaling.
  The live/repo alarm now uses `FILL(requests,0)`. A desired-3 test changed 3->2 at
  19:21:26 SGT and 2->1 at 19:32:38. After the first 15-minute window, conservative
  `-1` removal plus drain/cooldown took about 11 minutes per additional GPU.
- This is deliberately conservative at baseline but too slow for a sudden event burst.
  A 73% sample at 07:00 alarmed at 07:03:48; launch began 07:04:01; all targets were
  healthy at 07:09:27; all public-prime markers completed at 07:11:30.
- Local deep warm validates each GPU. Public prime validates the fleet's public route,
  but ALB may send a GPU's probe to another GPU. Exact per-target routed synthesis is
  not guaranteed. A dedicated warm target group/promotion path remains future work.
- New nodes become ALB-healthy before their public prime finishes. The event gate
  therefore requires desired/InService/healthy coverage plus a fresh public-RIFF
  marker newer than the current worker start.
- The SSM polling fix only waits and checks again when a command is still pending.
  It prevents a false failure report; it does not make GPU warming faster.

## Verified Test Evidence

- Two slots passed the 50/50 mandatory deep-warm gate. Three slots was rejected:
  only 39/50 targets passed; no three-slot user load was run.
- With browser-equivalent keepalive, real three-turn complete-flow bursts passed:
  50 GPUs/100 users 100/100; 50/150 150/150; primed 60/100 100/100; 60/150 150/150.
- Evening first-WAV-after-text-done repeat, with first-chunk verification enabled:
  50/100 completed 100/100, 50/150 completed 149/150 (one 720-second no-turn
  timeout), primed 60/150 completed 150/150, and 60/100 completed 100/100.
  Aggregate average/p50/p95 was 3.44/2.22/9.81, 4.06/3.14/10.47,
  5.18/2.65/11.82, and 2.42/2.02/4.19 seconds respectively.
- Turn-one first-audio p50/p95: 50/100 12.72/13.98 s; 50/150 7.15/14.61 s;
  60/100 13.33/22.40 s; 60/150 7.61/14.20 s. OpenAI answer length was uncontrolled,
  so these runs prove completion/reliability, not a clean fleet-size latency comparison.
- Deployed early-sentence browser smoke: first audio 12.42 s in a new session and
  3.26/2.96 s on warm turns. One scripted backend control measured text done 2.06 s,
  first TTS chunk 3.40 s, and speech-to-first-audio 5.46 s. These are functional
  checks, not population p50/p95 evidence.
- Fixed cold Live route cost: the router eagerly loads Live at 512 MB and GI pins the
  full model snapshot. ID-only/direct callers still resolve saved profiles; regular
  Live Fast/Full already pins its selected model. No-GPU first invocation fell
  4.618 s -> 15.71 ms. Full reruns passed 100/100 and 150/150 three-turn users.

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

- Dev GI text chat now works; signed-in browser verification of Dean audio and learner REST calls
  remains. Their OAC header fix is deployed, but successful real-token synthesis is not yet observed.
- Keep alias/provisioned concurrency as a future option only. The next latency targets
  are 150-user admission retries and rare outside-Lambda transit outliers.
- For faster reactive scaling, build a real fleet-wide high-resolution occupancy
  publisher every 10 seconds and test three consecutive samples. Merely changing the
  current alarm period does not create 10-second source data.
- Do not enable three slots, FSR, a longer CloudFront timeout, or Lambda memory changes
  without a controlled benchmark. Current evidence does not justify them as baseline.
- Admin work: grant scoped Lambda ASG permissions; deregister/terminate the two stopped
  validators listed in `TODO.md`; consider a second private subnet/AZ.
