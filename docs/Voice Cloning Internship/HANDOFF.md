# Voice Cloning Project Handoff

Last updated: 2026-07-31

## Purpose and Sources

- Pushed branch: `codex/staging-multi-user-scaling`; use `git log -1` for the latest commit.
- Full AWS map/history: repo `docs/staging-architecture.md`
- Machine map: repo `scripts/deploy.config.json`; operations: vault `docs/deployment.md`
- History: vault `CHANGELOG.md`/`BUGS.md`; active tasks: `TODO.md`
- Never put credentials or secret values in chat, Git, or Markdown.
## UI and Application State
- Staging chatbot: `https://d25sg72wp8oj5g.cloudfront.net/`; dev reference: `https://d2o0cbe2zunqkr.cloudfront.net/`.
- The correct chatbot build is GI mode, not generic `build:chatbot`.
- Staging serves `assets/index-DfcO_k9s.js` from `staging-chatbot` commit `846893e`,
  profile `deanvoice-v1`, with the GI lesson video preserved.
- Staging Lambda pins GPT, SoVITS, references, profile, and revision per conversation.
- CloudFront rule 3 sends model/reference/inference paths to the optimized target;
  training and WebSocket traffic remain on their separate services.
## Live AWS State
- Account/region/role: `329599637774` / `ap-northeast-2` / `arn:aws:iam::329599637774:role/Liu_Teng_Yu_Intern2026`
- Live ASG `vcs-staging-gpu-inference`: min 1, desired 1, max 192.
- Healthy baseline is selected by the ASG; describe it live instead of relying on a
  saved instance ID.
- Current AMI `ami-021aeb72894b8c79b` contains commit `330d329`.
- Launch template `lt-07728350a25e691a4` defaults to v20. New nodes require verified
  HTTP 200 + RIFF public-prime responses before writing the event-ready marker.
- Target group `vcs-stg-opt-3103`: ports 3103 data/3004 control, two synthesis slots per `g6.xlarge`.
- Private subnet `subnet-0c1937ef298f54500`, GPU SG `sg-03a2f3dddf4eff21c`,
  instance profile `VoiClo_GPU`. Fleet is single-AZ.
- Live event schedule: min/desired 50 at 08:30 SGT and back to min/desired 1 at
  17:00 SGT on 2026-08-03. Actions were read back from AWS.
- Live gateway `i-0f0da8be59367f7a8` is running and healthy in `vcs-staging-tg-3002`.
  `GPU_SCHEDULE_ENABLED=true`. CloudWatch recorded one Lambda invocation every five
  minutes, including quiet hours, so an automatic invoker exists; this role cannot
  list its scheduler resource, and the exact 07:00/23:00 transition is unverified.
- Final cleanup: ASG min/desired 1; occupancy alarm enabled/OK; rejection alarm is
  telemetry-only with actions disabled.
## Access Procedure
Export fresh `VCS_AWS_ACCESS_KEY_ID`, `VCS_AWS_SECRET_ACCESS_KEY`, and
`VCS_AWS_SESSION_TOKEN` into Codex. Map to `AWS_*`, assume the role, verify account
`329599637774`, and never print values.
Working permissions cover AMI/LT/ASG/ELB, SSM command execution, S3, Lambda, and
CloudFront. Denied during this work: `ssm:ListCommandInvocations`,
  `autoscaling:DeletePolicy`, `autoscaling:SetInstanceProtection`,
  `autoscaling:SuspendProcesses`, `events:PutRule`, Lambda EventBridge permission,
  and EC2 reboot.
Use per-instance `ssm:GetCommandInvocation`.

## Work Completed
- Implemented bounded model-aware queues, two tested same-model slots per GPU,
  immutable voice snapshots, S3-backed Live Full state, and Lambda capacity retries.
- Created Target Optimizer target group/services, launch template, ASG, target
  tracking, listener cutover, and staging SG rules.
- v20 runs configurable concurrent local rounds, blocks Target Optimizer behind restart-safe warm,
  then requires successful real public synthesis responses with RIFF validation.
- Added `wait-staging-event-ready.ps1`: it checks desired/InService/healthy coverage
  and the per-node deep/public-prime marker in SSM batches of at most 50.
- Added event controls to `scripts/provision-staging-autoscaling.ps1`.
  `VCS_STAGING_EVENT=true` selects 50; paired prewarm/scale-down times are mandatory.
- GI students do not call model selection/warm on page entry; each ASG node performs
  that preparation once before advertising capacity, avoiding a user-entry warm burst.
- Live scale-out is always active, including outside event mode. A one-minute
  metric computes occupied synthesis slots / (`HealthyHostCount * 2`); below five
  healthy GPUs, 70% sets capacity to five rather than adding ten. At five or more,
  70% adds exactly 10 GPUs, then evaluates later samples again. The old rejection alarm
  is telemetry-only. Idle scale-in remains -1 after 15 quiet minutes; floor 1.
- Lambda capacity retries are bounded to 30 seconds and marked; routed retries receive
  priority over normal entries in each GPU's local queue.
## Test Evidence
- Fresh auto-primed v17 50 GPUs passed 100/100. First-audio averages by turn:
  6.51/2.16/2.03s. Hot 150 delivered turn one to 150/150 and completed 148/150;
  two later WebSockets closed 1006 and no TTS request failed.
- The final v19 50-GPU, two-slot real-flow test completed 99/100 three-turn sessions
  (one WebSocket 1006) and 130/150 (20 WebSocket 1006). No completed TTS chunk failed.
  First-audio p50/p95 was 6.44/7.69s for 100-user turn one and 7.51/12.25s for
  150-user turn one. The 150 wave crossed occupancy, then desired changed 50->60
  after the approximately 160-second wave; reactive EC2 scale-out was too late to
  rescue it.
- Three slots per GPU was rejected before user load: only 39/50 targets passed the
  mandatory 10-round concurrent deep-warm gate; 11 worker restarts failed. Two slots
  were restored and passed the same gate 50/50.
- A later two-slot hot run exposed a separate gateway risk. At 100 users only 33/100
  sessions completed; at 150 only 13/150 completed. Most failures were WebSocket 1006
  while ALB WebSocket idle timeout was 60 seconds and median turn-one completion was
  69.70/87.22 seconds. This is strong correlation, not yet heartbeat-verified causation.
- Readiness now rejects a public-prime marker older than the current worker start.
  A post-boot worker restart therefore requires a fresh public route proof.
- This is one passing event rehearsal, not a guarantee. Verify schedule, quota,
  target health, cloud-init prime completion, and alarm state before the event.
- Commands: `node scripts/load-test-staging-tts.mjs 50` for TTS-only, or
  `node scripts/load-test-staging-chatbot.mjs 50` for WebSocket->OpenAI->DeanVoice.

## Incidents and Recovery
- Historical cold-start and rollout incidents are preserved in `BUGS.md` and
  `docs/staging-architecture.md`; health means verified synthesis, not an open port.
- Validator `i-015de451bff24a73b` is stopped but remains registered as unused; an admin
  must deregister it from `vcs-stg-opt-3103` and terminate it because this role is denied.
- Stopped v15 validator `i-0eb2ca68edb88d6d7` also needs administrator termination.

## Event Plan and Next Session
- Live actions start 50 GPUs at 08:30 and return to 1 at 17:00 SGT on 2026-08-03.
- Times are flexible via `VCS_STAGING_PREWARM_AT` and `VCS_STAGING_SCALE_DOWN_AT`;
  set both, rerun with `-Apply`, then verify AWS. Env changes alone do not reschedule.
- Repo/live max is 192. Max 200 exceeds the audited 768-vCPU On-Demand quota;
  usage, cost, and single-AZ capacity still apply.
- Before admitting users, run `ensure-staging-live-gateway.ps1 -Apply`, then
  `wait-staging-event-ready.ps1 -ExpectedCapacity 50`; do not treat route health alone
  as event readiness. Remaining work: fix/verify WebSocket heartbeat or raise the
  ALB idle timeout, verify the scheduled boundary transition, 60-minute soak, and
  target termination test.
- Next session: read the three sources, check Git, assume the role, live-describe
  LT/ASG/targets/schedules, and public-smoke before changes. On failure inspect target
  health, `warm_timing`, services, entry-file size, and SG egress. Preserve isolation;
  commit and push all repo changes.
- Post-event training/Live Full scaling requirements and option downsides are recorded
  in vault `DECISIONS.md`; exact test methods/timings are in repo architecture docs.
