# Staging Environment — Complete Architecture Reference

**Environment:** `staging` (the stable copy for users; development happens on `dev`)
**Region:** ap-northeast-2 (Seoul) · **Account:** 329599637774
**Last control-plane inventory:** 2026-07-07 · **Last public-path check:** 2026-07-28

> **Keep this file up to date.** Any change to staging infra (console, CLI, or script) must be reflected here in the same PR/commit. Every ID below was read from AWS on the date above — an AI session can diff this file against `aws describe-*` output to detect drift.
>
> Related docs: `docs/dev-environment-duplication-guide.md` (step-by-step from-scratch build recipe; note its "dev" naming means today's "staging"). The original deployment handoff (`staging-environment-handoff.md`) was deleted after launch — recoverable from git history if needed.

## 1. Big picture

```
Browser
  │
  ├─ https://d1qh0ebsvevhy3.cloudfront.net   (training UI)      CF EC2SYT1OKGW9Q
  ├─ https://dfzrfr93t2ruf.cloudfront.net    (live-fast UI)     CF E3DE2SRSU9JAEG
  └─ https://d25sg72wp8oj5g.cloudfront.net   (chatbot UI)       CF E3MLIO4CZFOPEO
        │ static assets        → S3 echolect-staging/dist-*
        │ /api/* (control)     → Lambda Function URL (start/stop GPU, model list, presign…)
        │ GPU paths (below)    → ALB voice-gpu-alb-staging → GPU instance ports 3001-3003
        ▼
   GPU instance i-0f0da8be59367f7a8 (g6.xlarge, PRIVATE subnet, no public IP)
        │ outbound internet via NAT nat-0dadc68ca781b8df9
        └─ S3 via gateway endpoint vpce-0386d983dfdff41dc
```

On-demand lifecycle: the Lambda **starts** the GPU when a user needs it; an EventBridge rule (pending — see §10) POSTs `/api/instance/idle-check` every 5 min so the Lambda **stops** it after `GPU_IDLE_STOP_MINUTES=90` of inactivity. Until that rule exists, stop the instance manually.

## 2. CloudFront distributions

| App | Domain | Distribution ID | Static origin (S3) |
|---|---|---|---|
| training | d1qh0ebsvevhy3.cloudfront.net | `EC2SYT1OKGW9Q` | `echolect-staging/dist-training` |
| live-fast | dfzrfr93t2ruf.cloudfront.net | `E3DE2SRSU9JAEG` | `echolect-staging/dist-live-fast` |
| chatbot | d25sg72wp8oj5g.cloudfront.net | `E3MLIO4CZFOPEO` | `echolect-staging/dist-chatbot` |

Each distro has three origin types: S3 (static, via OAC; bucket policy on the shared bucket includes all 3 distro ARNs), the staging Lambda Function URL (API/control paths), and the staging ALB (GPU paths). Full origin/behavior JSON snapshots: `docs/aws-snapshots/cf-*-staging.json` (note: snapshots are of the *original* distros used as templates — verify against live config before relying on them).

**Complete environment map (do not infer environment from a similar name):**

| Environment | GPU EC2 | Lambda | Training | Live TTS | Chatbot | S3 application prefix |
|---|---|---|---|---|---|---|
| staging | `voice-gpu-staging` | `Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging` | d1qh0ebsvevhy3.cloudfront.net | dfzrfr93t2ruf.cloudfront.net | d25sg72wp8oj5g.cloudfront.net | `echolect-staging/` |
| dev | `VoiClo-GPU-Seoul` | `Liu_Teng_Yu_Intern2026-Voice_Cloning_Project` | d3dghqhnk7aoku.cloudfront.net | doovx82fh9tfs.cloudfront.net | d2o0cbe2zunqkr.cloudfront.net | `echolect/` |

`d3fwx6qxeaxfmo.cloudfront.net` is the separate GI-bleeding chatbot, not the dev
Dean chatbot.

On 2026-07-28, the staging chatbot was rebuilt from `chatbot-live-full` commit
`9821dd5` and deployed as `assets/index-Dnjl1fjR.js`. Its fixed staging profile is
`deanvoice-v1`; it uses the staging Lambda/ALB/GPU stack. All three staging
distributions now use CloudFront Function `vcs-staging-spa-route-rewrite` on the
default static behavior instead of global 403/404-to-200 error mappings. Deep frontend
routes still serve `index.html`, while real `/api/*` errors retain their HTTP status
and JSON content type.

## 3. Load balancer

- **ALB:** `voice-gpu-alb-staging` — DNS `voice-gpu-alb-staging-1031778835.ap-northeast-2.elb.amazonaws.com`
  arn: `arn:aws:elasticloadbalancing:ap-northeast-2:329599637774:loadbalancer/app/voice-gpu-alb-staging/781c056e87784609`
- internet-facing, subnets `subnet-02484fe5c859c7d80` + `subnet-0692e838cd2e7c7c7` (public), SG `sg-0027def934fd4cb8d`
- **Listener:** HTTP :80 (`…listener/…/16873b8d49639f2e`). HTTPS not needed — CloudFront terminates TLS and talks HTTP to the ALB.

**Listener rules (priority order):**

| Prio | Path pattern(s) | Target group | Backend service |
|---|---|---|---|
| 1 | `/api/live/chat/realtime` | vcs-staging-tg-3002 | live gateway (WebSocket) |
| 2 | `/inference/progress/*` | vcs-staging-tg-3003 | inference worker |
| 3 | `/models*`, `/ref-audio*`, `/inference*` | vcs-staging-tg-3003 | inference worker |
| default | everything else | vcs-staging-tg-3001 | gpu worker (training) |

**Target groups** (all HTTP, health check `GET /healthz`, interval 30 s, healthy threshold 5, target = the staging instance):

| Name | Port | ARN suffix |
|---|---|---|
| vcs-staging-tg-3001 | 3001 | `targetgroup/vcs-staging-tg-3001/782635b79a09031d` |
| vcs-staging-tg-3002 | 3002 | `targetgroup/vcs-staging-tg-3002/77d07064082cbead` |
| vcs-staging-tg-3003 | 3003 | `targetgroup/vcs-staging-tg-3003/3449adfcba215f65` |

⚠️ After a **new instance** is launched (e.g. from a fresh AMI), it must be re-registered in all three TGs — registration is per-instance-ID, and stop/start of the *same* instance keeps it registered.

## 4. GPU instance

| Property | Value |
|---|---|
| Instance ID | `i-0f0da8be59367f7a8` (Name `voice-gpu-staging`, tag `Environment=staging`) |
| Type / AMI | g6.xlarge / `ami-06338e47a2f1bae6a` (snapshot of the dev box, 2026-07-06) |
| Subnet | `subnet-0c1937ef298f54500` (private, 10.0.32.0/20, AZ apne2a) — **no public IP** |
| Private IP | 10.0.37.234 (changes if a new instance is launched; irrelevant to TGs which track the ID) |
| Key pair | `VoiClo-Gpu-Seoul` (SSH unused — access is SSM only) |
| IAM instance profile | `VoiClo_GPU` (S3 access, SSM) |
| Security group | `sg-03a2f3dddf4eff21c` (`vcs-staging-gpu-sg`) |
| First-boot config | user-data = `docs/aws-snapshots/staging-userdata.sh`; log `/var/log/staging-bootstrap.log`; marker `/home/ubuntu/STAGING_BOOTSTRAP_DONE` |

**Services on the box** (systemd, code at `/home/ubuntu/VoiceCloning`, branch
`codex/staging-multi-user-scaling` at commit `1c945b9` on disk):

| Port | systemd unit | Role | Env file |
|---|---|---|---|
| 3001 | `gpu-worker` | training/cloning worker | `gpu-worker/.env` (`S3_PREFIX=echolect-staging/`, staging CORS) |
| 3002 | `voice-live-gateway` | realtime live-chat gateway (OpenAI realtime API) | `live-gateway/.env` (holds `OPENAI_API_KEY`, `PORT=3002`, `OPENAI_REALTIME_MODEL=gpt-realtime`, `OPENAI_REALTIME_VAD=semantic_vad`, staging CORS) |
| 3003 | `gpu-inference-worker` | TTS inference worker | `gpu-inference-worker/.env` (same S3/CORS changes) |
| 3103 / 3004 | `target-optimizer-inference` | ALB Target Optimizer data/control proxy to 3003 | reads inference `.env`; advertises `SYNTHESIS_MAX_CONCURRENCY=2` |

All three expose `GET /healthz` for the ALB health checks. Direct-to-worker endpoints return 403 to plain curl (origin/internal-auth checks) — same behavior as dev; not a bug.

## 5. Networking

**VPC:** `vpc-0b81d044238fcee4d` (10.0.0.0/16) — **shared with dev**; isolation between environments is by security group, not by VPC.

**Staging private subnet** `subnet-0c1937ef298f54500` → route table `rtb-068aad306c3adcbe0`:

| Destination | Target |
|---|---|
| 10.0.0.0/16 | local |
| 0.0.0.0/0 | `nat-0dadc68ca781b8df9` (NAT gw in public subnet `subnet-0692e838cd2e7c7c7`, EIP 43.200.210.184 / eipalloc-0e3b4e564f9b5acca) |
| S3 prefix list `pl-78a54011` | S3 gateway endpoint `vpce-0386d983dfdff41dc` |

(A second, unassociated route table `rtb-00bf8ce2b545ffc4e` exists from the NAT-outage workaround — harmless; can be deleted.)

⚠️ **History:** the original NAT was deleted by an unknown actor on 2026-07-06→07 (routes went blackhole, box lost internet). If staging suddenly can't reach the internet, check this route table first. The role cannot edit routes (`ec2:ReplaceRoute` denied) — that's an admin fix.

**Security groups:**

| SG | Name | Ingress | Egress |
|---|---|---|---|
| `sg-03a2f3dddf4eff21c` | vcs-staging-gpu-sg (instance) | tcp 3001-3003 **from sg-0027def934fd4cb8d only** | all |
| `sg-0027def934fd4cb8d` | VoiClo-Gpu-Seoul-ALB-SG (shared by dev+staging ALBs) | 80, 443 from 0.0.0.0/0 | tcp 3001, 3002, 3003 → `sg-0806b2491f69f242e` (dev GPU SG) **and** → `sg-03a2f3dddf4eff21c` (staging GPU SG) |

⚠️ **Hard-won lesson:** the ALB SG's *egress* must include the staging GPU SG. On first launch only the dev-GPU egress existed and all health checks failed with `Target.Timeout`. If health checks time out, check ALB SG egress before suspecting the services.

## 6. Lambda (control plane)

| Property | Value |
|---|---|
| Function | `Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging` |
| Runtime / size / timeout | nodejs24.x / 128 MB / 120 s, handler `index.handler` |
| Exec role | `Liu_Teng_Yu_Intern2026-LambdaExecutionRole` (shared with dev Lambda — scoped staging role is an open admin ask) |
| Function URL | `https://7xx6w7q5jwzda6nlltlyfckfzm0vyfmy.lambda-url.ap-northeast-2.on.aws/` — AuthType **NONE**, needs BOTH resource policy statements (`FunctionURLAllowPublicAccess` + `FunctionURLAllowInvokeAction`; a URL 403s with only the first) |

**Environment variables** (secrets redacted; change with get-function-configuration → edit one key → update-function-configuration, never rebuild the map by hand):

| Key | Value |
|---|---|
| GPU_INSTANCE_ID | `i-0f0da8be59367f7a8` ← must track the current staging instance |
| GPU_INSTANCE_REGION | ap-northeast-2 |
| GPU_IDLE_STOP_MINUTES | 90 |
| GPU_SCHEDULE_ENABLED / START / END / TZ | false / 7 / 19 / Singapore |
| INFERENCE_CAPACITY_RETRY_MS | 30000 |
| GPU_WORKER_URL, INFERENCE_WORKER_URL | `http://voice-gpu-alb-staging-1031778835.ap-northeast-2.elb.amazonaws.com` |
| GPU_WORKER_PUBLIC_URL | `https://dfzrfr93t2ruf.cloudfront.net` |
| CORS_ORIGIN | the 3 staging CloudFront domains (comma-separated) |
| S3_BUCKET / S3_PREFIX / S3_REGION | `interns2026-small-projects-bucket-shared` / `echolect-staging/` / ap-southeast-1 |
| ARTIFACT_SOURCE / MODEL_SOURCE | s3 / s3 |
| LIVE_DEMO_LOCKOUT | **true on the 2026-07-28 public `/api/config` check** (the 2026-07-07 control-plane snapshot recorded false) |
| VOICE_PROFILE_INTERNAL_AUTH_HEADER_NAME / _VALUE | `x-internal-key` / *(redacted — read from the Lambda env)* |

## 7. S3 layout

Bucket `interns2026-small-projects-bucket-shared` (**ap-southeast-1**, not Seoul), prefix `echolect-staging/`:
`dist-training/`, `dist-live-fast/`, `dist-chatbot/` (frontend bundles) · `models/` (incl. `models/user-models/gpt|sovits/`) · ref audio, artifacts — mirrors `echolect/` (dev). Bucket policy grants the 3 staging CF distro ARNs read via OAC.

## 8. Git branches ↔ environments

| Branch | Deploys to | Notes |
|---|---|---|
| `separate-containers-new` | dev (training + live-fast) | active development |
| `chatbot-live-full` | dev (chatbot) | |
| `staging` | staging (training + live-fast) | fast-forward from `separate-containers-new` when promoting |
| `staging-chatbot` | staging (chatbot) | fast-forward from `chatbot-live-full` |

Deploy tooling: `scripts/deploy-client.ps1 -Env staging|dev -Mode training|live-fast|chatbot`, `deploy-lambda.ps1`, `deploy-worker.ps1`, driven by `scripts/deploy.config.json` (holds instance IDs, distro IDs, S3 targets; staging worker access = **SSM**, dev = SSH). Client env vars per environment: `client/env/{staging,dev}/*.env`.

## 9. Access / operations

- **AWS access:** portal creds for identity account 116310094355 → `aws sts assume-role --role-arn arn:aws:iam::329599637774:role/Liu_Teng_Yu_Intern2026` (portal creds ~2 h, role session 1 h). Role denials (console too): `iam:*`, `events:*`, `scheduler:*`, `elasticloadbalancing:Delete*`, `ec2:ReplaceRoute/DeleteRoute/ReplaceRouteTableAssociation`, `ec2:ModifyVpcEndpoint`, `ssm:DescribeInstanceInformation`. `ssm:StartSession` **is** allowed.
- **Shell on the box:** `aws ssm start-session --region ap-northeast-2 --target i-0f0da8be59367f7a8` then `sudo -iu ubuntu`. No SSH (private subnet).
- **Manual stop/start:** EC2 console or `aws ec2 stop-instances/start-instances --instance-ids i-0f0da8be59367f7a8`. Same-instance stop/start preserves TG registration, Lambda config, and IP-independence (everything references the instance ID or ALB DNS).
- **Smoke test:** `https://d1qh0ebsvevhy3.cloudfront.net/api/models` → 200 JSON; `/api/instance/status` → `workerReady:true` when the box is up; TG health `describe-target-health` all `healthy`.

## 10. Multi-user readiness and 2026-08-03 event

### Implemented multi-user behavior

The staging application is no longer event- or Dean-specific at the code layer:

- Every request carries an immutable `voice_model` snapshot. A browser conversation
  also freezes its engine, profile, and references until that conversation stops, so
  another user changing the active UI/profile cannot switch its voice mid-reply.
- The inference worker has a bounded FIFO scheduler (`SYNTHESIS_MAX_QUEUE_DEPTH=100`,
  `SYNTHESIS_MAX_QUEUE_WAIT_MS=25000`). Same-model work may use the tested physical
  concurrency; different-model work waits for the active model batch to drain before
  the atomic GPT/SoVITS pair is changed.
- Live Fast, direct inference, Live Full generation/regeneration, and model mutations
  all use the same scheduler. Demo preemption/bypass was removed.
- Live Full manifests, ordered SSE events, chunks, previews, finals, cancellation
  markers, and mutable session state are persisted in S3. Any inference target can
  hydrate/relay the session, so horizontal routing does not depend on instance-local
  ownership.
- Training has its own bounded serial FIFO queue on the fixed training worker. It is
  deliberately not sent to the inference ASG.
- Lambda retries capacity responses (`429`/`503`) for a bounded configurable budget
  (`INFERENCE_CAPACITY_RETRY_MS=30000` live on staging).

Staging `g6.xlarge` testing supports `SYNTHESIS_MAX_CONCURRENCY=2` for one loaded voice:
four simultaneous verified requests all returned distinct valid WAVs in 10.8 seconds;
ten simultaneous verified requests all returned valid WAVs in 32.7 seconds. No worker
warning/OOM was recorded, and post-test GPU memory was about 2.95 GiB of 23 GiB. This
means one GPU supports multiple users, but it does **not** meet a 50-request burst
latency target by itself.

### Staging scaling design

Do not use a SageMaker **training job**; it is batch model training, not an online
inference server. Migrating to a SageMaker real-time endpoint would require a new
serving contract and is higher risk than scaling the already-tested EC2 worker.

The implemented staging design keeps the public hostnames and separates roles:

1. The existing instance remains the training/live-gateway control target.
2. Inference instances run only `gpu-inference-worker` plus the pinned AWS ALB Target
   Optimizer proxy. Each target advertises physical concurrency `2`.
3. New target group `vcs-stg-opt-3103` uses data port 3103 and Target Optimizer control
   port 3004. The source image is `ami-07ecb50a65a104ef1`, built from commit `1c945b9`.
4. `scripts/provision-staging-autoscaling.ps1` creates/updates the launch template,
   ASG, target tracking, listener switch, and scheduled actions. Prewarm is configured
   by `VCS_STAGING_PREWARM_AT`, `VCS_STAGING_PREWARM_CAPACITY`, and
   `VCS_STAGING_SCALE_DOWN_AT`, not hardcoded into application behavior.
5. For a 50-request near-simultaneous burst, the measured one-GPU throughput supports
   an initial event plan of 16 prewarmed GPUs (32 immediate physical slots, then one
   short queued wave). This must be confirmed with the complete fleet before declaring
   the 50-user acceptance test passed.

Target Optimizer requires a new target group and its agent on every inference target.
Do not apply it to the WebSocket gateway on port 3002 or the training worker on 3001.

### Load-test acceptance plan

Test the complete staging CloudFront route with production-shaped requests and a fixed
DeanVoice profile. Do not benchmark only static files or `/api/instance/status`.

1. Establish single-request baseline service time and real-time factor for short,
   medium, and long chatbot sentences.
2. Run 10, 25, 50, then 60 concurrent virtual users. Use independent clients/DNS and a
   5-minute ramp, 15-minute hold, plus a 50-user near-simultaneous burst.
3. Model think time from the lecture workflow; “100 logged in, 50% active” is not the
   same as 50 synthesis requests every second.
4. Pass only if there is no cross-user cancellation/audio mix-up, no worker crash/OOM,
   no sustained 409/429/5xx, and agreed p95 latency is met. Record p50/p95/p99 latency,
   request success, retries, queue/wait time, ALB response time, Lambda duration/
   throttles, GPU utilization/memory, and per-target active requests.
5. Repeat the accepted load for 60 minutes, then perform one target termination during
   a lower-load resilience run and verify draining/replacement.
6. Run a final rehearsal on 2026-08-02 at 08:00 SGT with the exact fleet size and keep
   a rollback path to the original single instance/target group.

CloudFront load testing must use multiple independent clients and DNS resolution. It is
not permitted when Origin Shield is enabled or when the tested cache behavior has a
Lambda@Edge viewer-request/viewer-response trigger; verify both before the run.

Capacity formula after measurement:

`required GPUs = ceil(peak synthesis requests/second × p95 service seconds ÷ target utilization)`

Use a target utilization no higher than `0.7` for the event. Also test the true
simultaneous burst: the formula describes sustained throughput, not the wait experienced
when 50 students all submit at once.

**Results recorded 2026-07-28 through the real staging Lambda URL:**

| Probe | Result |
|---|---|
| Cold correct-profile request | 200 valid WAV, 48.8 s |
| 2 concurrent, scheduler concurrency 1 | both 200; 4.3 s wall; correctly serialized |
| 2 concurrent, concurrency 2, verification enabled | both 200; 9.7 s wall |
| 4 concurrent, concurrency 2, verification disabled | 4/4 valid WAV; 7.1 s wall |
| 4 concurrent, concurrency 2, verification enabled | 4/4 valid WAV; 10.8 s wall |
| 10 concurrent, concurrency 2, verification enabled | 10/10 valid WAV; 32.7 s wall |

The 25/50/60-user and 60-minute fleet tests remain blocked until the launch-template/
ASG permissions below are granted. Do not claim the 2026-08-03 capacity goal is met
from the one-GPU probes.

### AWS permissions needed

Keep discovery and implementation permissions in separate, short-lived sessions. Scope
write access to resources tagged `Environment=staging` and the staging S3 prefix wherever
the AWS action supports resource conditions.

Read-only audit:

- `sts:GetCallerIdentity`, plus `sts:AssumeRole` on
  `arn:aws:iam::329599637774:role/Liu_Teng_Yu_Intern2026`
- EC2/Auto Scaling/ELB describe actions; CloudFront get/list; Lambda get/list; S3
  `ListBucket` for `echolect-staging/*` plus bucket configuration reads
- CloudWatch metric/alarm reads, CloudWatch Logs describe/get/filter, Service Quotas
  get/list, and SSM describe/list/get-command-invocation

Staging implementation:

- EC2 launch-template, image, security-group-rule, capacity-reservation, tag, and
  run/terminate actions needed by the approved design
- Auto Scaling create/update/tag/attach-target-group, policy, scheduled-action,
  lifecycle-hook, instance-refresh, and warm-pool actions
- ELB create/modify/tag target groups, target registration, target health, and listener
  rule changes (Target Optimizer requires a new target group)
- `iam:PassRole` limited to the existing staging EC2 instance profile and
  `iam:CreateServiceLinkedRole` only if the Auto Scaling service-linked role is absent
- SSM `SendCommand`/session access to staging instances; Secrets Manager or Parameter
  Store read for the instance role that retrieves runtime secrets
- CloudWatch `PutMetricData`, log delivery, dashboard/alarm writes, and SNS notification
  writes for the staging observability resources
- Service Quotas `RequestServiceQuotaIncrease` for the Seoul EC2 G/VT quota if the
  applied vCPU quota is too low
- Lambda configuration/code/concurrency writes only if retry, event-mode, or monitoring
  changes are implemented; S3 object access restricted to
  `arn:aws:s3:::interns2026-small-projects-bucket-shared/echolect-staging/*`

CloudFront changes are not expected for the preferred design because its ALB origin DNS
stays stable. Load-test runners need no AWS write permission when run externally; an
  AWS-hosted distributed runner additionally needs its own CloudFormation/ECS/Fargate,
  ECR, S3, CloudWatch Logs, and `iam:PassRole` permissions.

**Permissions actually denied during the 2026-07-28 rollout:**

- `ec2:CreateLaunchTemplate` (hard blocker; scope to launch templates named
  `vcs-staging-gpu-inference*`)
- `autoscaling:CreateLaunchConfiguration` (fallback also denied; granting the launch
  template path is preferred)
- `elasticloadbalancing:ModifyTargetGroupAttributes`
- `servicequotas:ListServiceQuotas`
- `sqs:ListQueues`, `dynamodb:ListTables` (not required by the selected S3-backed
  session design)
- `ssm:SendCommand`, `ssm:GetCommandInvocation` (interactive `ssm:StartSession` works)

The launch-template path also needs `ec2:CreateLaunchTemplateVersion`,
`ec2:ModifyLaunchTemplate`, `ec2:RunInstances`, `ec2:CreateTags`, and
`iam:PassRole` limited to `VoiClo_GPU`. Auto Scaling needs
`autoscaling:CreateAutoScalingGroup`, `UpdateAutoScalingGroup`,
`PutScalingPolicy`, `PutScheduledUpdateGroupAction`, and describe actions. The listener
cutover needs `elasticloadbalancing:ModifyRule`. Confirm the Seoul On-Demand G/VT quota
is at least 64 vCPUs for the proposed 16 x `g6.xlarge` event fleet.

## 11. Known gaps / pending admin work (updated 2026-07-28)

1. **Idle-stop EventBridge rule `vcs-staging-gpu-idle-stop` does not exist yet** — GPU must be stopped manually (g6.xlarge ≈ $1/hr). Admin commands (`events:*` is denied for our role):
```powershell
aws events put-rule --region ap-northeast-2 --name vcs-staging-gpu-idle-stop --schedule-expression "rate(5 minutes)"
aws lambda add-permission --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging --statement-id AllowEventBridgeGpuIdleStop --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:ap-northeast-2:329599637774:rule/vcs-staging-gpu-idle-stop
aws events put-targets --region ap-northeast-2 --rule vcs-staging-gpu-idle-stop --targets "Id=1,Arn=arn:aws:lambda:ap-northeast-2:329599637774:function:Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging,Input='{\"rawPath\":\"/api/instance/idle-check\",\"requestContext\":{\"http\":{\"method\":\"POST\"}}}'"
```
   Console: EventBridge → Rules → Create rule → Schedule rate(5 minutes) → target the `-staging` Lambda → target input = Constant (JSON) `{"rawPath":"/api/instance/idle-check","requestContext":{"http":{"method":"POST"}}}` (Lambda permission is auto-added via console). Verify: Lambda Monitor tab shows an invocation every 5 min.
2. Leftover `voice-gpu-alb-dev` (`…/app/voice-gpu-alb-dev/17b83508f5602cd7`) + `vcs-dev-tg-3001/3002/3003` to delete (~$20/mo, serves nothing — artifact of the early naming flip). Admin (`elasticloadbalancing:Delete*` denied): `aws elbv2 delete-load-balancer --region ap-northeast-2 --load-balancer-arn <arn above>`, then delete the 3 TGs. ⚠️ `voice-gpu-alb` (April 2026, no suffix) is dev's REAL ALB — do not delete. Optional extra cleanup our role can do: deregister April AMI `ami-0a0a13fc71687e5cc` + snapshot `snap-04c1cb16d3a338c33` (~$2.5/mo); keep golden image `ami-06338e47a2f1bae6a`.
3. Both Lambda Function URLs (dev + staging) are public (`NONE`) — harden to AWS_IAM + CloudFront OAC.
4. Rotate the OpenAI API key (it lived in the dev box's unit file; staging keeps it in `live-gateway/.env`).
5. Optional: scoped `vcs-lambda-staging` exec role instead of the shared one.
6. Ask admin whether NAT gateways get auto-cleaned — whitelist `nat-0dadc68ca781b8df9` (see §5 history).
7. The target-optimized target group `vcs-stg-opt-3103` and AMI
   `ami-07ecb50a65a104ef1` have been created. ASG/launch template/listener cutover and
   the 07:15 scheduled prewarm are **not created** because the current role denied
   `ec2:CreateLaunchTemplate` and the legacy launch-configuration fallback. Grant the
   scoped permissions in §10, run `scripts/provision-staging-autoscaling.ps1`, launch
   one target, verify health, then use `-SwitchListener`.
8. Only one NAT-backed private subnet currently exists (`ap-northeast-2a`). A
   production-resilient fleet should add another private subnet/AZ before relying on
   multi-AZ capacity. Route edits are admin-only for this role.
