# Deployment Notes

## Current Shape

The repo docs describe a split cloud deployment:

- CloudFront serves the frontend and is the browser entrypoint.
- Lambda Function URL handles `/api/*` REST traffic.
- A GPU ALB forwards long-lived browser traffic to GPU-side services.
- GPU EC2 hosts three app processes:
  - `gpu-worker` on `3001`
  - `live-gateway` on `3002`
  - `gpu-inference-worker` on `3003`

## Environment Map

The authoritative resource-level inventory is repo `docs/staging-architecture.md`;
always read and live-verify it before AWS work.

| Environment | GPU | Lambda | Training CF | Live TTS CF | Chatbot CF | S3 prefix |
|---|---|---|---|---|---|---|
| staging | `voice-gpu-staging` | function ending `-staging` | d1qh0ebsvevhy3.cloudfront.net | dfzrfr93t2ruf.cloudfront.net | d25sg72wp8oj5g.cloudfront.net | `echolect-staging/` |
| dev | `VoiClo-GPU-Seoul` | function without `-staging` | d3dghqhnk7aoku.cloudfront.net | doovx82fh9tfs.cloudfront.net | d2o0cbe2zunqkr.cloudfront.net | `echolect/` |

`d3fwx6qxeaxfmo.cloudfront.net` is the separate GI-bleeding chatbot.

As of 2026-07-29, staging chatbot serves the GI build from `staging-chatbot` commit
`846893e`, bundle `assets/index-DfcO_k9s.js`, with fixed profile `deanvoice-v1`.
The lesson video is preserved under `echolect-staging/dist-chatbot/videos/`. The three staging
CloudFront distributions use static-behavior SPA rewrites rather than global 404-to-200
fallbacks, so API errors preserve their real status.

## 2026-08-02 Capacity Work

- Staging code is generally multi-user: immutable voice snapshots, a bounded model-aware
  scheduler, S3-backed Full sessions, and queued training are deployed.
- A g6.xlarge has been validated at two same-model synthesis slots. Ten simultaneous
  verified requests returned 10/10 valid WAVs in 32.7 seconds without worker OOM.
- Target group, final AMI, launch template, ASG, target policy, and one inference
  instance exist. ALB rule 3 is cut over and public synthesis passes.
- Pre-scale before 07:15 SGT; do not depend on reactive GPU launch for the 08:00 burst.
- Initial measured plan is 16 prewarmed GPUs for a 50-request burst; finish the
  25/50/60-user fleet tests before acceptance.
- SageMaker training jobs do not serve inference. A SageMaker real-time endpoint may be
  revisited after the event, but migration risk is higher than scaling the existing EC2
  worker for this deadline.

## Important Routing

- `/api/live/chat/realtime` must reach `live-gateway`.
- `/models*`, `/ref-audio*`, and `/inference*` must reach `gpu-inference-worker`.
- Other GPU worker traffic defaults to `gpu-worker`.
- Browser SSE paths stay off Lambda:
  - `/train/progress/*`
  - `/inference/progress/*`

## Deployment Touchpoints By Area

- Frontend changes:
  - Build from `client/`
  - Upload build output to the frontend bucket/prefix
  - Invalidate CloudFront
- Lambda changes:
  - Package from `lambda/`
  - Update Lambda function code
- GPU worker changes:
  - Pull code on EC2
  - Restart the affected service
  - Verify the deployed GPT-SoVITS runtime includes the `v2ProPlus` assets plus `2-get-sv.py`/SV checkpoint support expected by the training pipeline
  - For Live Full phoneme verification, install `espeak-ng` at the OS level and `phonemizer` plus `transformers>=4.40,<5` in `PYTHON_EXEC`; pre-warm `facebook/wav2vec2-lv-60-espeak-cv-ft` or allow its first verified technical term to download it. The inference-worker Dockerfile includes these dependencies.

## Dev Deployment Reference (Not Staging)

- Target AWS account: `329599637774`
- Assume role: `arn:aws:iam::329599637774:role/Liu_Teng_Yu_Intern2026`
- EC2 SSH: `ubuntu@43.203.248.253`
- PEM: `C:\Users\User\Downloads\PC_SYNC\VoiClo-Gpu-Seoul.pem`
- EC2 repo: `/home/ubuntu/VoiceCloning`
- Branch: `separate-containers-new`
- Inference service: `gpu-inference-worker`
- Seoul Lambda: `Liu_Teng_Yu_Intern2026-Voice_Cloning_Project`
- Lambda region: `ap-northeast-2`
- Frontend bucket: `interns2026-small-projects-bucket-shared`
- Frontend prefix: `echolect/dist-live-fast/`
- Application S3 prefix: `echolect/`
- Dev CloudFront distribution: `E36CNBL620DMGM`

Use fresh SSO credentials for account `116310094355` only to call `sts assume-role`;
never save access keys or session tokens in this vault or repo. Export the returned
role credentials into the current process, then verify `aws sts get-caller-identity`
reports account `329599637774`.

Durable deploy order:

1. Run local tests/builds and package Lambda.
2. Commit and push `separate-containers-new`.
3. On EC2, preserve any intentional tracked edits, `git fetch`, then
   `git merge --ff-only origin/separate-containers-new`; do not delete the two known
   unrelated archives if still present.
4. Restart `gpu-inference-worker`; verify `systemctl is-active`, `/activity/status`,
   and sidecar-active log lines. `/` and `/health` are not worker health endpoints.
5. Update the non-staging Seoul Lambda with
   `lambda/.dist/voice-cloning-function-url.zip` and wait for a successful update.
6. Sync `client/dist-live-fast/` to
   `s3://interns2026-small-projects-bucket-shared/echolect/dist-live-fast/`.
7. Invalidate `/*` on CloudFront `E36CNBL620DMGM`, wait for completion, and verify
   the public bundle/API behavior.

## Staging Inference Takeover and Rebuild Runbook

Start every staging AWS session by reading repo `docs/staging-architecture.md`, repo
`scripts/deploy.config.json`, vault `HANDOFF.md`, and vault `TODO.md`. Work from
`codex/staging-multi-user-scaling` for Lambda/GPU/ASG changes. The deployed GI client
is built separately from `staging-chatbot`; `scripts/deploy-client.ps1` intentionally
rejects a chatbot build from another branch.

1. Check `git status` and `git log -3`. Preserve unrelated local changes. Export fresh
   temporary `VCS_AWS_*` credentials outside chat, map them to `AWS_*`, assume the
   authorised staging role, and verify the destination account. Never write credentials
   into source, logs, reports, or Markdown.
2. Read live state before trusting recorded IDs: describe the ASG, launch-template
   default, AMI, scaling policies, alarms, scheduled actions, listener rule, target
   group, instance subnet/security group/profile, and service quota. Run one public
   RIFF smoke request before making changes.
3. Run targeted tests locally. Current baseline commands are `npm.cmd test` in
   `lambda/`, `node --test "src/**/*.test.js"` in `gpu-inference-worker/`, Node syntax
   checks for changed scripts, PowerShell parser/dry-run checks for the provisioner,
   and JSON parsing for both deployment configuration files.
4. Package Lambda with `npm.cmd run package:function-url` from `lambda/`. Update only
   the staging Lambda, wait for `LastUpdateStatus=Successful`, and run the public TTS
   smoke. Capacity retries are implemented in Lambda, so an AMI rebuild alone does not
   deploy retry changes.
5. For the GI client, switch to `staging-chatbot`, confirm the expected commit and
   clean tree, then run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-client.ps1 -Env staging -Mode chatbot
   ```

   This selects `build:gi`, syncs `dist-gi` to the staging chatbot prefix while
   preserving `videos/*`, and creates a CloudFront invalidation. Verify the public
   bundle, lesson video, pinned `deanvoice-v1`, and real API status handling.
6. Update a baseline ASG worker through SSM without exposing it as unhealthy halfway
   through deployment. Temporarily use EC2 health while stopping/restarting the
   Target Optimizer-facing service, fast-forward the repo to the pushed commit,
   restart `gpu-inference-worker`, run `scripts/warm-staging-deanvoice.sh`, start
   Target Optimizer only after the real RIFF route warm succeeds, verify public audio,
   and restore ELB health checks. Stopping Target Optimizer while ELB health remains
   authoritative caused an earlier ASG replacement and must not be repeated.
7. Before creating an AMI, verify `git rev-parse HEAD`, service state, the non-zero
   inference entry-file size, the warm timing output, one Python API process, and one
   valid public WAV. Flush the filesystem (`sync`) before `ec2 create-image`. Wait for
   the AMI to become `available`; do not promote a pending or unverified image.
8. Create a new launch-template version from the known-good version, changing only the
   reviewed AMI/user-data fields, and set it as default. Run the staging provisioner
   without `-Apply` first:

   ```powershell
   $env:VCS_STAGING_EVENT='true'
   $env:VCS_STAGING_PREWARM_CAPACITY='50'
   $env:VCS_STAGING_MAX_CAPACITY='192'
   $env:VCS_STAGING_SCALE_OUT_REJECTS_PER_MINUTE='1'
   $env:VCS_STAGING_SCALE_OUT_ADD_CAPACITY='10'
   $env:VCS_STAGING_PREWARM_AT='2026-08-02T07:15:00+08:00'
   $env:VCS_STAGING_SCALE_DOWN_AT='2026-08-02T18:00:00+08:00'
   .\scripts\provision-staging-autoscaling.ps1 -AmiId <verified-ami> -DesiredCapacity 1
   ```

   Review the dry run, then repeat with `-Apply`. Use `-SwitchListener` only when an
   intentional listener cutover is required. Environment variables do not update AWS
   until the provisioner is applied.
9. For a scale rehearsal, raise min/desired explicitly, record request start, metric
   minute, alarm transition, desired-capacity change, EC2 launch, cloud-init finish,
   route warm, and optimizer capacity separately. Use per-instance
   `ssm:GetCommandInvocation`; `ssm:ListCommandInvocations` is denied.
10. Run the complete chatbot harness and the closed-loop TTS harness described in repo
    `docs/staging-architecture.md`. State whether verification was skipped. Save raw
    JSON under ignored `.tmp/`; copy durable aggregate results into the architecture
    document rather than committing large session transcripts.
11. Restore min/desired 1 and max 192 after testing. Re-read both scheduled actions,
    verify only one healthy `InService` baseline remains, run a public RIFF smoke, then
    update repo architecture/config and vault deployment/handoff/TODO/bugs/changelog.
    Commit and push the code repository. Remove temporary credentials from User scope.

The GI student page does not load models or send a warm inference when each student
enters. It reads the pinned profile and begins work when chat starts. Model, primary
reference, five auxiliary references, throwaway synthesis, and the real TTS route are
prepared once by each ASG instance before Target Optimizer starts. This avoids a
redundant student-entry warm-up burst.

## Staging ASG State (2026-07-29)

- Final image `ami-0a2618372e7f8b8da` contains commit `fff074c`; launch template
  `lt-07728350a25e691a4` default version 14 uses `g6.xlarge`, `VoiClo_GPU`, and the
  staging GPU security group.
- ASG `vcs-staging-gpu-inference` is min 1/max 192/desired 1. Current healthy v14 target
  `i-0b8ce19b5fe17d751` is in `subnet-0c1937ef298f54500`; min 1 keeps a warm baseline.
- Listener rule 3 routes inference/model/reference traffic to Target Optimizer group
  `vcs-stg-opt-3103`.
- Live scale-out adds 10 GPUs after at least one Target Optimizer rejection in a
  one-minute period. The reject threshold and fixed increment are environment/config
  settings. Scale-in removes one instance after fifteen no-traffic minutes.
  Warmup/health grace is 10 minutes, cooldown 5 minutes, and target drain up to
  2 minutes. Normal scale-in stops at min 1; an event min 50 cannot auto-scale below
  50 until the paired scale-down action restores min/desired 1.
- Target Optimizer does not queue rejected requests. Lambda retries within 30 seconds;
  a request routed on retry is marked and receives priority in the worker's local
  queue. A slot may be briefly unused while rejected Lambdas sleep before retry.
- Launch-template v14 requires two concurrent RIFF responses before advertising two
  slots. A fresh validator completed both syntheses in 3 seconds, full cloud-init warm
  in 206 seconds, became healthy in the real target group, and passed public RIFF synthesis.
- v14 starts Target Optimizer only after the complete DeanVoice warm succeeds.
- Public GI DeanVoice synthesis passed after fresh-instance cold-load validation.
  A fresh v10 node completed cloud-init in 442 seconds: its timed warm command spent
  9 seconds on cache lookups, 273 seconds loading the Python/base/voice model stack,
  and 96 seconds on reference caching plus first synthesis. The same command on an
  already initialized node took 13 seconds.
- A 16-node warm fleet returned 50/50 requests (p50 20.18 s, p95 24.30 s) and then
  60/60 (p50 3.67 s, p95 9.09 s). A cold 60-request burst returned 60 HTTP 504s and
  did not trigger scaling before timeout, so the 07:15 SGT scheduled prewarm is
  mandatory. Paired 07:15/18:00 SGT actions are now live for 2026-08-02.
- After real-route warm, 32 GPUs completed 50/50 three-turn chatbot sessions. Median
  first voice by turn was 7.57/3.79/4.11 seconds. At 100 users, all completed first
  voice and 98 completed all three turns; the busiest sample still had five free slots,
  so desired correctly stayed 32.
- A closed-loop 100-user/120-second TTS run with verification skipped returned 2,427/2,427 valid WAVs at
  p50/p95 3.86/11.31 seconds and retained two free slots. A separate 192-user trigger
  produced a true zero-capacity minute at 20:20 SGT: alarm 20:23:43, desired 32->51,
  launch 20:23:56, all 19 new route-warm checks complete by 20:28:31.
- On the hot 51-GPU fleet, 100/100 users completed three turns. Median first voice was
  5.02/3.34/3.40 seconds and total response 23.54/19.04/17.15 seconds. A hot 50-user
  comparison also passed 50/50 with first voice 5.69/4.10/4.30 seconds; no two-user
  first-audio penalty was observed, but generated answer lengths varied.
- A prior one-user response's 14 chunks ran one after another in about 28 seconds.
  It did not autoscale because sequential chunks did not exhaust the fleet. Use
  `node scripts/load-test-staging-chatbot.mjs 50` for the complete-flow test.
- Repo uses max 192 and the requested event default is 50, with
  `VCS_STAGING_PREWARM_CAPACITY` and `VCS_STAGING_MAX_CAPACITY` overrides. Max 200
  is invalid against the verified 768-vCPU/192-instance On-Demand G/VT quota.
- Live one-time actions set min/desired 50 at 07:15 SGT on 2026-08-02 and
  restore min/desired 1 at 18:00 SGT. Both were read back and verified on
  2026-07-30. The provisioner accepts flexible ISO timestamps through
  `VCS_STAGING_PREWARM_AT` and `VCS_STAGING_SCALE_DOWN_AT`, requires both, and rejects
  an end time that is not later than the start. Rerun with `-Apply` to change AWS;
  setting environment variables alone does not modify an existing schedule.
- After testing, live min/desired was restored to 1 and max remains 192. The schedule
  was re-read unchanged after cleanup.
- Validator `i-015de451bff24a73b` is stopped but remains registered as an unused target.
  An administrator must deregister it from `vcs-stg-opt-3103` and terminate it because
  this role is denied both actions; its stopped EBS volume still incurs storage cost.
- The v14 event rerun waited for all 50 two-slot gates before load. Immediate 100 users
  completed 68/100 (32 first-chunk 504s); hot 150 users completed 144/150 (six
  WebSocket 1006 closures). A real 226-rejection minute changed desired 50->60
  exactly, and all 60 route-warmed targets then completed 150/150. Fifty is not a
  reliable immediate-burst capacity; 60 has one passing v14 wave, not a guarantee.

Detailed per-turn timing definitions, the complete test ledger, warm-up ownership,
burst interpretation, and evaluated future options with downsides are maintained in
repo `docs/staging-architecture.md`. Keep this operational file concise enough to use
as a runbook; do not duplicate raw per-session JSON here.

## Repo Files Worth Checking First

- `docs/lambda-serverless-gpu-worker-guide.md`
- `docs/external-chatbot-handoff.md`
- `docs/containerization-images-split.md`
- `docker/gpu-worker/entrypoint.sh`
- `docker/gpu-inference-worker/entrypoint.sh`
- `systemd/gpu-inference-worker.service`

Historical only:

- `CLOUD_FRONTEND_FLOW_README(Outdated).md`
- `docs/complete_ai_handoff(Outdated).md`
- `docs/gpu-ec2-from-scratch-setup(Outdated).md`

## Current Repo Gap

- The repo currently checks in `gpu-inference-worker.service`.
- Matching checked-in systemd units for `gpu-worker` and `live-gateway` were not present in this scan.
