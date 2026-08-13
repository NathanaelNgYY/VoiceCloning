# Voice Cloning Project Handoff

Last updated: 2026-08-13

- Staging inference ASG now matches the fixed GPU's 24-hour availability: live
  min/desired is 1/1 and the retained 07:00 and 19:00 Singapore actions both set 1/1.
  Direct Lambda-to-ASG coupling remains unavailable because the Lambda role lacks
  Auto Scaling permission; matching scheduled actions preserve the continuous floor.
  Live readback found the fixed GPU running and its Lambda schedule enabled, 0-24.
- Fresh LT v26 instance `i-040b58dedddec65de` completed the full active-profile warm
  in 627 seconds with 10 real two-slot RIFF rounds. Whisper medium became active, the
  CUDA phoneme model loaded and produced real decisions, both automated public primes
  returned HTTP 200 RIFF first try, both services are active, worker restarts are zero,
  and the optimized target is healthy. Hot rounds after cold loading took 2-4 seconds.

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

## Start Here

- Current scope includes dev parity plus a separately confirmed staging event action.
- Repo/branch: `VoiceCloning` / `separate-containers-new`.
- Dev and staging branches have diverged on purpose. Staging carries the deployable
  chatbot instructions (`/api/chatbot/system-prompt` + the panel's Deploy button); dev
  carries learner analytics. See DECISIONS.md "Branch Divergence: Dev vs Staging"
  before merging either way.
- Dev-host checkout and GitHub `separate-containers-new` are synchronized at `ce75eab`;
  the gateway restarted and passed 56/56 tests. A recovery backup and two unrelated
  archives remain untracked on the host; do not remove them as deployment cleanup.
- Read this file, repo `docs/staging-architecture.md`, `TODO.md`, and
  `scripts/deploy.config.json` before changing AWS or code.
- Never print or save credentials, tokens, private URLs, or secret values.

## Deployed Dev State

- Dev training/live/GI CloudFront configs match their staging counterparts after
  substituting dev Lambda, ALB, and `echolect/` origins; all three are deployed.
- Dev Lambda includes the `ce75eab` analytics route, 512 MB, 120 seconds, and a 30-second inference
  retry budget. `GPU_SCHEDULE_ENABLED=false` and no inference ASG name is configured.
- Fixed GPU `VoiClo-GPU-Seoul` checkout is `ce75eab`; inference
  has two synthesis slots, the 100-item/25-second queue, and boot warming enabled.
- Dev has no ASG, scaling alarms, or ASG scheduled actions. The enabled five-minute
  EventBridge rule invokes idle-check only; activity requests own GPU startup.
- Dev GI now batches anonymous lesson/video events to partitioned S3 through Lambda;
  the patched gateway also gives uncertain rewind/pause/skip signals to the chatbot.

## Current AWS Operating State

- Region/account/role: Seoul / `329599637774` /
  `Liu_Teng_Yu_Intern2026`; verify the assumed identity before every mutation.
- ASG `vcs-staging-gpu-inference`: continuous min/desired 1, max 192; launch-template
  `lt-07728350a25e691a4` defaults to v26; two synthesis slots per `g6.xlarge`.
- Optimized target group is `vcs-stg-opt-3103`. The separate live gateway is running
  and healthy in `vcs-staging-tg-3002`; do not stop it during event preparation.
- Verified one-time actions set min/desired 50 at 13:30 SGT and return to 1 at
  16:00 SGT on 2026-08-04. Do not admit users until strict readiness passes;
  observed launch-to-readiness can take about 8 minutes.
- The fixed GPU now has 24-hour availability. Matching ASG actions both preserve
  min/desired 1 at 07:00 and 19:00 Singapore. Exact manual-state coupling is deployed
  but disabled pending Lambda-role Auto Scaling permissions.
- Live read at 2026-08-03 11:36 SGT found min 50 / desired 56 from today's event;
  legacy action `vcs-staging-scale-down` restores min/desired 1 at 17:00 today.
  Tomorrow's 13:30/16:00 actions are separate and remain scheduled as documented.

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
- Relevant checks passed: client, Lambda, gateway, build, public RIFF, and browser flow.
- One passing burst is not production proof. The 60-minute soak and target-loss/
  draining rehearsal remain undone.

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

## Staging Handover (2026-08-13, handing to Codex)

Staging branch `codex/staging-multi-user-scaling` is clean and pushed at `264bc8f`.
Deployed and verified live: Lambda, both kiosk clients, and the live gateway.

What changed and is live:

- Deployable assistant instructions: `GET/PUT /api/chatbot/system-prompt`, a Deploy
  button in the panel, and a startup fetch on both kiosk builds. Editor is confined to
  the text-chat build via `showInstructionsEditor`; the GI build reads but cannot edit.
- Auth exemption by origin (`LIVE_AUTH_EXEMPT_ORIGINS`) on both the gateway and the
  Lambda synthesis route, covering the open kiosk's CloudFront host *and* its custom
  domain. The SSO app still requires a token — verified on all four origins.
- `session.auth.failed` now ends the session client-side instead of hanging in
  `connecting` with the panel's Deploy/Reset locked.
- Idle scale-in works again: the no-traffic alarm now treats missing data as breaching.
  Step stays at -1 per firing by operator choice; the fleet drains gradually.

Open items, highest value first:

1. The deployed prompt in S3 currently holds a throwaway test prompt. Reset it to the
   bundled default before any student uses the app; "Reset to default" restores the
   bundled text, then Deploy.
2. One fleet instance runs newer worker source than its siblings (a surgical
   `git checkout` of `gpu-inference-worker/src/`). Harmless and tested; it disappears
   when that instance is replaced, or becomes the image if it is the bake source.

Corrections worth carrying forward, so they are not re-derived:

- GPU instances **are** warmed at boot by
  `gpu-inference-worker.service.d/staging-warm.conf`, and they stay warm for hours
  with the voice model loaded. Earlier notes claiming "never warmed" or "warm decays"
  were wrong; both came from indirect signals. Ask `/inference/status` instead.
- The stuck "Preparing live chat" was never OpenAI. It was the gateway refusing a
  handshake the open kiosk could not perform.

## Next Session Priorities and Blockers

- Keep alias/provisioned concurrency as a future option only. The next latency targets
  are 150-user admission retries and rare outside-Lambda transit outliers.
- For faster reactive scaling, build a real fleet-wide high-resolution occupancy
  publisher every 10 seconds and test three consecutive samples. Merely changing the
  current alarm period does not create 10-second source data.
- Do not enable three slots, FSR, a longer CloudFront timeout, or Lambda memory changes
  without a controlled benchmark. Current evidence does not justify them as baseline.
- Admin work: grant scoped Lambda ASG permissions; deregister/terminate the two stopped
  validators listed in `TODO.md`; consider a second private subnet/AZ.
