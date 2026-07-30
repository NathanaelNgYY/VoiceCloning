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
- Healthy baseline instance after the rehearsal: `i-0b8ce19b5fe17d751`.
- Current AMI `ami-021aeb72894b8c79b` contains commit `330d329`.
- Launch template `lt-07728350a25e691a4` defaults to v15.
- Target group `vcs-stg-opt-3103`: ports 3103 data/3004 control, two synthesis slots per `g6.xlarge`.
- Private subnet `subnet-0c1937ef298f54500`, GPU SG `sg-03a2f3dddf4eff21c`,
  instance profile `VoiClo_GPU`. Fleet is single-AZ.
- Live event schedule: 50 at 07:15 SGT, back to 1 at 18:00 SGT on
  2026-08-02. Both scheduled actions were read back and verified on 2026-07-30.
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
- Live v15 requires 10 concurrent two-slot rounds (20 valid local RIFF syntheses)
  before advertising capacity, covering first-chunk and verified later-chunk paths.
- Added event controls to `scripts/provision-staging-autoscaling.ps1`.
  `VCS_STAGING_EVENT=true` selects 50; paired prewarm/scale-down times are mandatory.
- Live LT v15 gates on all 10 two-slot RIFF rounds before advertising capacity.
- GI students do not call model selection/warm on page entry; each ASG node performs
  that preparation once before advertising capacity, avoiding a user-entry warm burst.
- Live scale-out adds 10 GPUs after at least one rejection in a one-minute period.
  Both values are repository/env-configurable. Idle scale-in is -1 after 15 quiet
  minutes; floor 1 outside event mode.
- Lambda capacity retries are bounded to 30 seconds and marked; routed retries receive
  priority over normal entries in each GPU's local queue.
## Test Evidence
- v14 newly two-slot-warmed 50 GPUs completed 68/100 three-turn users; 32 first
  chunks returned 504. Hot 50 GPUs delivered turn-one voice 150/150, then six
  sessions closed WebSocket 1006, leaving 144/150 complete.
- A real 226-rejection minute exercised the fixed policy exactly 50->60. After all
  ten added v14 nodes route-warmed, 150/150 users completed all three turns with
  average first-audio 5.94/2.44/2.36s and no TTS/WebSocket failures.
- A fresh v15 validator ran deep warm in 26s and total cloud-init in 256s. Newly
  warmed 50 GPUs still completed only 59/100 (40 first-turn 504s, one later 1006);
  the same hot fleet completed 150/150 at average first-audio 7.04/3.01/2.81s.
- Verdict: 50 is not reliable for the immediate event burst. Sixty passed one
  150-user v14 wave; earlier route-warmed 80 also passed, so keep safety headroom.
- Commands: `node scripts/load-test-staging-tts.mjs 50` for TTS-only, or
  `node scripts/load-test-staging-chatbot.mjs 50` for WebSocket->OpenAI->DeanVoice.

## Exact Cold-Start Meaning
The old “352 seconds” was one combined warm-script timer, not ordinary EC2 boot or
voice generation. Commit `62f86ff` added phase timing.

- Initialized node: 13s = GPT check 5s, SoVITS check 4s, pair 1s, ref/warm synth 3s.
- Old fresh v10 node: 378s warm command and 442s boot-to-cloud-init completion.
- Fresh breakdown: cache 9s, Python/GPT/SoVITS/BERT/CNHuBERT load 273s,
  reference preparation plus first synthesis 96s.
- The fresh-only delay is consistent with first reads of snapshot-backed EBS blocks;
  it was not S3 downloads because cache checks took only 8-9s.
- A fresh v15 validator completed 20 local syntheses in 26s and full cloud-init in
  256s. Public cold-burst failure proves localhost warm is not adequate readiness.

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
- Validator `i-015de451bff24a73b` is stopped but remains registered as unused; an admin
  must deregister it from `vcs-stg-opt-3103` and terminate it because this role is denied.
- Stopped v15 validator `i-0eb2ca68edb88d6d7` also needs administrator termination.

## Event Plan and Next Session
- Live event actions for 2026-08-02 are 50 at 07:15 and back to 1 at
  18:00 SGT.
- Times are flexible via `VCS_STAGING_PREWARM_AT` and `VCS_STAGING_SCALE_DOWN_AT`;
  set both, rerun with `-Apply`, then verify AWS. Env changes alone do not reschedule.
- Repo/live max is 192. Max 200 exceeds the audited 768-vCPU On-Demand quota;
  usage, cost, and single-AZ capacity still apply.
- The corrected 32-GPU route-warm passed 50/50 but the 100-user run completed 98/100
  sessions. The v14 and v15 50-GPU newly warmed rehearsals were unreliable; extra
  localhost deep warm did not help. v14 fixed-step 60 and earlier 80 each passed
  150/150 once. Decide prewarm, test routed readiness, soak, and target termination.
- Next session: read the three sources, check Git, assume the role, live-describe
  LT/ASG/targets/schedules, and public-smoke before changes. On failure inspect target
  health, `warm_timing`, services, entry-file size, and SG egress. Preserve isolation;
  commit and push all repo changes.
- Post-event training/Live Full scaling requirements and option downsides are recorded
  in vault `DECISIONS.md`; exact test methods/timings are in repo architecture docs.
