# Voice Cloning Project Handoff

Last updated: 2026-07-29

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
- Healthy baseline instance after the rehearsal: `i-02ed1e071bbf085d2`.
- Final AMI `ami-0ffe20a0a5986a0cb` contains commit `2ab26ee`.
- Launch template `lt-07728350a25e691a4` defaults to v13.
- Target group `vcs-stg-opt-3103`: ports 3103 data/3004 control, two synthesis slots per `g6.xlarge`.
- Private subnet `subnet-0c1937ef298f54500`, GPU SG `sg-03a2f3dddf4eff21c`,
  instance profile `VoiClo_GPU`. Fleet is single-AZ.
- Event schedule: 32 at 07:15 SGT, back to 1 at 18:00 SGT on 2026-08-02.
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
- Added `scripts/warm-staging-deanvoice.sh`: check/load weights, cache main plus five
  auxiliary references, make a throwaway clip, validate readiness, and log timings.
- Added event controls to `scripts/provision-staging-autoscaling.ps1`.
  `VCS_STAGING_EVENT=true` selects 32; paired prewarm/scale-down times are mandatory.
- LT v13 starts Target Optimizer only after weights, references, and a valid RIFF from
  the real `/inference/tts` route have warmed.
- GI students do not call model selection/warm on page entry; each ASG node performs
  that preparation once before advertising capacity, avoiding a user-entry warm burst.
- Scale-out is +60% after one minute sampled with zero optimizer capacity plus rejected
  traffic. Any sampled free slot blocks scale-out. Idle scale-in removes one after
  15 quiet minutes; warmup/grace 10m, cooldown 5m, drain 2m, floor 1.
- Lambda capacity retries are bounded to 30 seconds and marked; routed retries receive
  priority over normal entries in each GPU's local queue.
## Test Evidence
- Corrected route-warm, 32 GPUs/50 users/3 turns: 50/50 complete; median first voice
  7.57/3.79/4.11s; median totals 31.05/27.80/29.02s.
- 32 GPUs/100 users/3 turns: all 100 completed first-turn voice, 98 completed all
  turns; five free slots remained at the busiest sample, so desired correctly stayed 32.
- Closed-loop 100 users for 120s with verification skipped: 2,427/2,427 valid WAVs, p50/p95 3.86/11.31s;
  two free slots remained. Retry rejects and free capacity can coexist because
  rejected Lambdas sleep before retry while slots finish work.
- A deliberate 192-user trigger produced a zero-capacity minute at 20:20 SGT. Alarm
  entered at 20:23:43, desired went 32->51, launches began 20:23:56, and all 19 new
  nodes passed cloud-init/route-warm/service checks by 20:28:31.
- Hot 51-GPU full flow: 100/100 completed all three turns; median first voice
  5.02/3.34/3.40s and totals 23.54/19.04/17.15s. A subsequent 50/50 run had median
  first voice 5.69/4.10/4.30s. Two users/GPU showed no first-audio penalty here.
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
- Final v13 scale-out nodes completed full cloud-init and real-route warm about
  272-275s after launch, substantially faster than the earlier v10 measurement.

## Incidents and Recovery
- LT v9 AMI `ami-0b06a87a36a68328d` captured the worker entry file as zero bytes.
  It was rolled back; the source was verified at 3,577 bytes, synced, rebaked, and
  final AMI/LT v10 passed fresh-node/public testing.
- The old completed-request policy reacted to small sustained traffic and could scale
  despite available capacity. It is neutralized live because the role cannot delete it;
  the new zero-capacity policy is authoritative.
- Min/desired 1 is restored after the 32->51 rehearsal; `i-02ed1e071bbf085d2` is the
  healthy target.
- Health must mean usable synthesis, not only a listening Node service; LT v13 gates
  the ALB-facing Target Optimizer until the full warm completes.

## Event Plan and Next Session
- Event actions are live for 2026-08-02: 32 at 07:15, back to 1 at 18:00 SGT.
- Times are flexible via `VCS_STAGING_PREWARM_AT` and `VCS_STAGING_SCALE_DOWN_AT`;
  set both, rerun with `-Apply`, then verify AWS. Env changes alone do not reschedule.
- Repo/live max is 192. Max 200 exceeds the audited 768-vCPU On-Demand quota;
  usage, cost, and single-AZ capacity still apply.
- The corrected 32-GPU route-warm passed 50/50 but the 100-user run completed 98/100
  sessions; decide whether 32 is acceptable or raise event prewarm, then run a
  60-minute soak, one target termination, and the two-browser exact-revision race.
- Next session: read the three sources, check Git, assume the role, live-describe
  LT/ASG/targets/schedules, and public-smoke before changes. On failure inspect target
  health, `warm_timing`, services, entry-file size, and SG egress. Preserve isolation;
  commit and push all repo changes.
- Post-event training/Live Full scaling requirements and option downsides are recorded
  in vault `DECISIONS.md`; exact test methods/timings are in repo architecture docs.
