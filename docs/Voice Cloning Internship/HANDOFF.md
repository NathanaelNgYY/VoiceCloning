# Voice Cloning Project Handoff

Last updated: 2026-07-31

## Start Here

- Work only in staging unless the user explicitly expands scope.
- Repo/branch: `VoiceCloning` / `codex/staging-multi-user-scaling`.
- Current pushed commits: source/deployment `fc99271`; documentation `18d82ef`.
- Read this file, repo `docs/staging-architecture.md`, `TODO.md`, and
  `scripts/deploy.config.json` before changing AWS or code.
- Never print or save credentials, tokens, private URLs, or secret values.

## Deployed Staging State

- Chatbot: `https://d25sg72wp8oj5g.cloudfront.net/`; GI bundle
  `assets/index-DJ5lJmLS.js`, built from `fc99271`, fixed profile `deanvoice-v1`.
- Staging Lambda code from `fc99271` was successfully deployed on 2026-07-31
  08:38:42 UTC. It remains at 128 MB and 120-second timeout.
- Live Fast phrase mode starts TTS once a streamed multi-sentence reply has a
  confirmed complete first sentence and the next sentence has begun. A one-sentence
  answer still waits for text completion. Live Full and non-phrase modes are unchanged.
- Lambda returns profile-resolution, worker-round-trip, and total timing headers.
  The optional GPU queue header is not preserved by the public Target Optimizer path.
- Browser and complete-flow load harness send a WebSocket keepalive every 15 seconds.
  ALB idle timeout remains 60 seconds because this role cannot change it.

## Current AWS Operating State

- Region/account/role: Seoul / `329599637774` /
  `Liu_Teng_Yu_Intern2026`; verify the assumed identity before every mutation.
- ASG `vcs-staging-gpu-inference`: min 1, desired 1, max 192; launch-template
  `lt-07728350a25e691a4` defaults to v20; two synthesis slots per `g6.xlarge`.
- Optimized target group is `vcs-stg-opt-3103`. The separate live gateway is running
  and healthy in `vcs-staging-tg-3002`; do not stop it during event preparation.
- Event actions set min/desired 50 at 08:30 SGT and return to 1 at 17:00 SGT on
  2026-08-03. If users are meant to enter at 08:30, this prewarm time is too late:
  observed strict readiness after launch can take about 8 minutes, and reactive
  load-to-readiness took 11m46s.
- `GPU_SCHEDULE_ENABLED=true`. Lambda was observed invoking every five minutes, but
  this role cannot inspect the invoker and the exact 07:00/23:00 transition remains
  unverified. Do not create a duplicate scheduler until the existing invoker is known.
- Final audit: occupancy alarms enabled/OK; rejection alarm telemetry-only; ASG
  returned to baseline min/desired 1.

## Autoscaling and Readiness

- Scaling works outside event mode. Occupancy is occupied slots divided by
  `(healthy GPUs * 2)`, sampled in one-minute CloudWatch data.
- Below five healthy GPUs, one sample at or above 70% sets desired capacity to five.
  At five or more, one sample at or above 70% adds ten; later samples re-evaluate.
- Scale-in removes one GPU after 15 no-traffic minutes, with floor one.
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
- Turn-one first-audio p50/p95: 50/100 12.72/13.98 s; 50/150 7.15/14.61 s;
  60/100 13.33/22.40 s; 60/150 7.61/14.20 s. OpenAI answer length was uncontrolled,
  so these runs prove completion/reliability, not a clean fleet-size latency comparison.
- Deployed early-sentence browser smoke: first audio 12.42 s in a new session and
  3.26/2.96 s on warm turns. One scripted backend control measured text done 2.06 s,
  first TTS chunk 3.40 s, and speech-to-first-audio 5.46 s. These are functional
  checks, not population p50/p95 evidence.
- Relevant checks passed: 79 conversation-helper tests, full Lambda suite, 55
  live-gateway tests, GI build, public RIFF/timing smokes, and a real browser flow.
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

## Next Session Priorities and Blockers

- Run a controlled early-sentence A/B with comparable multi-sentence replies and
  record OpenAI first text/text done, TTS start, first audio, backend timing, p50/p95.
  The current Node harness waits for full text, so adapt it or instrument the browser.
- For faster reactive scaling, build a real fleet-wide high-resolution occupancy
  publisher every 10 seconds and test three consecutive samples. Merely changing the
  current alarm period does not create 10-second source data.
- Do not enable three slots, FSR, a longer CloudFront timeout, or Lambda memory changes
  without a controlled benchmark. Current evidence does not justify them as baseline.
- Admin work: optional ALB idle timeout to 300 seconds; deregister/terminate the two
  stopped validator instances listed in `TODO.md`; consider a second private subnet/AZ.
- Preserve previous results. Append new runs to repo `docs/staging-architecture.md`
  and mirror any allowed project-memory change in both vault locations.
