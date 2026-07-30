# Voice Cloning Project Handoff

Last updated: 2026-07-30

## Purpose and Sources

- Code: `C:\Users\lty\Downloads\VoiceCloning Internship\VoiceCloning`
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
- Healthy baseline instance after the rehearsal: `i-096eb75d9a4560973` (v17).
- Current AMI `ami-021aeb72894b8c79b` contains commit `330d329`.
- Launch template `lt-07728350a25e691a4` defaults to v17; user data is commit `4d06d14`.
- Target group `vcs-stg-opt-3103`: ports 3103 data/3004 control, two synthesis slots per `g6.xlarge`.
- Private subnet `subnet-0c1937ef298f54500`, GPU SG `sg-03a2f3dddf4eff21c`,
  instance profile `VoiClo_GPU`. Fleet is single-AZ.
- Live event schedule: begin preparing 50 at 06:50 SGT, event ready by 07:15,
  back to 1 at 18:00 SGT on 2026-08-02. Actions were verified live.
- Final cleanup: ELB health authority restored; rejection alarm OK/actions enabled;
  one public RIFF smoke passed in 3.27s.
## Access Procedure
Export fresh `VCS_AWS_ACCESS_KEY_ID`, `VCS_AWS_SECRET_ACCESS_KEY`, and
`VCS_AWS_SESSION_TOKEN` into Codex. Map to `AWS_*`, assume the role, verify account
`329599637774`, and never print values.
Working permissions cover AMI/LT/ASG/ELB, SSM command execution, S3, Lambda, and
CloudFront. Denied during this work: `ssm:ListCommandInvocations`,
`autoscaling:DeletePolicy`, `autoscaling:SetInstanceProtection`, and EC2 reboot.
Use per-instance `ssm:GetCommandInvocation`.

## Work Completed
- Implemented bounded model-aware queues, two tested same-model slots per GPU,
  immutable voice snapshots, S3-backed Live Full state, and Lambda capacity retries.
- Created Target Optimizer target group/services, launch template, ASG, target
  tracking, listener cutover, and staging SG rules.
- Fixed ALB SG egress for ports 3103/3004; missing egress caused health timeouts.
- Added `scripts/load-test-staging-tts.mjs`: concurrent public requests count only
  HTTP 200 `audio/wav` RIFF output as success.
- v17 runs 10 local two-slot rounds, blocks Target Optimizer behind restart-safe warm,
  then every new node sends two realistic public primes and waits for backend settle.
- Added event controls to `scripts/provision-staging-autoscaling.ps1`.
  `VCS_STAGING_EVENT=true` selects 50; paired prewarm/scale-down times are mandatory.
- GI students do not call model selection/warm on page entry; each ASG node performs
  that preparation once before advertising capacity, avoiding a user-entry warm burst.
- Live scale-out adds 10 GPUs after at least one rejection in a one-minute period.
  Both values are repository/env-configurable. Idle scale-in is -1 after 15 quiet
  minutes; floor 1 outside event mode.
- Lambda capacity retries are bounded to 30 seconds and marked; routed retries receive
  priority over normal entries in each GPU's local queue.
## Test Evidence
- Stable v16 still failed fresh 100/50 at 48/100; Lambda cold starts averaged only
  126.7ms while duration p95/max was 30.36/37.89s and Target Optimizer rejected 21.
- A realistic 100-request public prime absorbed 45 expected 504s; the following
  full flow passed 100/100. v17 automates that prime.
- Fresh auto-primed v17 50 GPUs passed 100/100. First-audio averages by turn:
  6.51/2.16/2.03s. Hot 150 delivered turn one to 150/150 and completed 148/150;
  two later WebSockets closed 1006 and no TTS request failed.
- This is one passing event rehearsal, not a guarantee. Verify schedule, quota,
  target health, cloud-init prime completion, and alarm state before the event.
- Commands: `node scripts/load-test-staging-tts.mjs 50` for TTS-only, or
  `node scripts/load-test-staging-chatbot.mjs 50` for WebSocket->OpenAI->DeanVoice.

## Exact Cold-Start Meaning
The old “352 seconds” was one combined warm-script timer, not ordinary EC2 boot or
voice generation. Commit `62f86ff` added phase timing.

- Old fresh v10: 442s cloud-init; 273s was Python/model load and 96s ref/first synth.
- Fresh v15: 20 local syntheses in 26s and cloud-init in 256s.
- v16 proved localhost readiness still did not warm the public burst; v17 adds it.

## Incidents and Recovery
- LT v9 AMI `ami-0b06a87a36a68328d` captured the worker entry file as zero bytes.
  It was rolled back; the source was verified at 3,577 bytes, synced, rebaked, and
  final AMI/LT v10 passed fresh-node/public testing.
- The old completed-request policy reacted to small sustained traffic and could scale
  despite available capacity. It is neutralized live because the role cannot delete it;
  the new zero-capacity policy is authoritative.
- Min/desired 1 was restored after the 50->80 rehearsal.
- Health must mean usable synthesis, not only a listening Node service; LT v14 gates
  the ALB-facing Target Optimizer until the full warm completes.
- v15 first-boot `unattended-upgrade` restarted warmed services and erased readiness.
  v16/v17 mask update units and rerun full warm on every worker restart.
- Validator `i-015de451bff24a73b` is stopped but remains registered as unused; an admin
  must deregister it from `vcs-stg-opt-3103` and terminate it because this role is denied.
- Stopped v15 validator `i-0eb2ca68edb88d6d7` also needs administrator termination.

## Event Plan and Next Session
- Live actions start 50-GPU preparation at 06:50, target readiness by 07:15, and
  return to 1 at 18:00 SGT.
- Times are flexible via `VCS_STAGING_PREWARM_AT` and `VCS_STAGING_SCALE_DOWN_AT`;
  set both, rerun with `-Apply`, then verify AWS. Env changes alone do not reschedule.
- Repo/live max is 192. Max 200 exceeds the audited 768-vCPU On-Demand quota;
  usage, cost, and single-AZ capacity still apply.
- v17 public-prime rehearsal passed fresh 100/100 and hot turn one 150/150. Remaining
  work: public smoke, gp3 headroom check, 60-minute soak, and target termination test.
- Next session: read the three sources, check Git, assume the role, live-describe
  LT/ASG/targets/schedules, and public-smoke before changes. On failure inspect target
  health, `warm_timing`, services, entry-file size, and SG egress. Preserve isolation;
  commit and push all repo changes.
- Post-event training/Live Full scaling requirements and option downsides are recorded
  in vault `DECISIONS.md`; exact test methods/timings are in repo architecture docs.
