# Staging Environment — Complete Architecture Reference

**Environment:** `staging` (the stable copy for users; development happens on `dev`)
**Region:** ap-northeast-2 (Seoul) · **Account:** 329599637774
**Last control-plane inventory:** 2026-07-29 · **Last public-path check:** 2026-07-29

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

On 2026-07-29, the staging chatbot was rebuilt in **GI mode** from
`staging-chatbot` commit `846893e` and deployed as `assets/index-DfcO_k9s.js`
(invalidation `I43HK3A7U66H6TC7RUUUUW6MLU`). Its fixed staging profile is
`deanvoice-v1`; it uses the staging Lambda/ALB/GPU stack. The lesson video is copied
to `echolect-staging/dist-chatbot/videos/gi-bleeding.mp4` because this distribution
does not have dev's separate `/videos/*` origin; GI deploy syncs preserve that path.
All three staging
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

## 10. Multi-user readiness and 2026-08-02 event

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

The stronger cross-chunk lock that pins the exact GPT/SoVITS references and profile
revision is committed on `codex/staging-multi-user-scaling` (`b86748c`) and the Dean
client branch `codex/chatbot-conversation-snapshot` (`4058357`). It still requires a
staging Lambda + chatbot deployment. Until that deployment, loading another profile
cannot alter an in-progress chunk, but overwriting the same saved profile ID between
separate Live Fast chunks remains a gap.

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
   port 3004. The validated image is `ami-0ffe20a0a5986a0cb`, built from commit
   `2ab26ee`. Launch template `vcs-staging-gpu-inference`
   (`lt-07728350a25e691a4`, default version 13) uses this AMI, `g6.xlarge`,
   `VoiClo_GPU`, and the staging GPU security group.
   ASG `vcs-staging-gpu-inference` now exists at desired capacity 1 with instance
   `i-02ed1e071bbf085d2`;
   `AWSServiceRoleForAutoScaling` also exists. Minimum
   capacity is 1 so public inference always has a warm baseline.
4. `scripts/provision-staging-autoscaling.ps1` creates/updates the launch template,
   ASG, target tracking, listener switch, and scheduled actions. Prewarm is configured
   by `VCS_STAGING_PREWARM_AT`, `VCS_STAGING_PREWARM_CAPACITY`,
   `VCS_STAGING_SCALE_DOWN_AT`, and `VCS_STAGING_MAX_CAPACITY`, not hardcoded into
   application behavior. `VCS_STAGING_EVENT=true` uses the configured event default
   only when an explicit prewarm capacity was not supplied.
5. The original 16-GPU event plan passed the complete 50- and 60-request public
   bursts. The requested event default is now 50 for additional headroom. This
   value is also applied to and verified on the live scheduled action.

The repository's next scaling configuration uses Target Optimizer rejection signals
rather than completed-request target tracking:

- scale out by 60% after one 60-second datapoint containing at least one
  `TargetControlRequestRejectCount`;
- do not require sampled free capacity to be zero; this is intentionally aggressive
  and can scale from one transient rejection;
- scale in one instance after fifteen one-minute periods with no ALB traffic;
- default instance warmup and ELB health grace are 600 seconds, default cooldown is
  300 seconds, and target deregistration delay is 120 seconds;
- normal scale-in stops at ASG minimum 1. An event action that raises minimum to 50
  deliberately blocks automatic scale-in below 50 until a paired action restores
  minimum/desired 1.

The ALB metric is published in 60-second periods, so this configuration cannot promise
an exact 30-second reaction. A true 30-second rule requires a custom high-resolution
metric publisher. Idle automatic scale-in begins after about fifteen quiet minutes and
may take another two minutes to drain. Reactive scale-out still cannot rescue the first
sudden burst because new GPUs take minutes to boot and warm. As of 2026-07-30, this
repository change is locally tested but the live alarm retains the earlier
zero-capacity-plus-rejection condition because the AWS source session expired.

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
6. Run a final rehearsal on 2026-08-01 at 08:00 SGT with the exact fleet size and keep
   a rollback path to the original single instance/target group.

CloudFront load testing must use multiple independent clients and DNS resolution. It is
not permitted when Origin Shield is enabled or when the tested cache behavior has a
Lambda@Edge viewer-request/viewer-response trigger; verify both before the run.

Capacity formula after measurement:

`required GPUs = ceil(peak synthesis requests/second × p95 service seconds ÷ target utilization)`

Use a target utilization no higher than `0.7` for the event. Also test the true
simultaneous burst: the formula describes sustained throughput, not the wait experienced
when 50 students all submit at once.

**Results recorded 2026-07-28 through 2026-07-30 through the real staging public path:**

| Probe | Result |
|---|---|
| Cold correct-profile request | 200 valid WAV, 48.8 s |
| 2 concurrent, scheduler concurrency 1 | both 200; 4.3 s wall; correctly serialized |
| 2 concurrent, concurrency 2, verification enabled | both 200; 9.7 s wall |
| 4 concurrent, concurrency 2, verification disabled | 4/4 valid WAV; 7.1 s wall |
| 4 concurrent, concurrency 2, verification enabled | 4/4 valid WAV; 10.8 s wall |
| 10 concurrent, concurrency 2, verification enabled | 10/10 valid WAV; 32.7 s wall |
| 50 concurrent, 16 prewarmed GPUs | 50/50; p50 20.18 s, p95 24.30 s, 25.35 s wall |
| 60 concurrent, same warm fleet after the first wave | 60/60; p50 3.67 s, p95 9.09 s, 9.92 s wall |
| 60 concurrent, one cold target | 0/60; all CloudFront/Lambda 504 around 30.7 s |
| Fresh launch-template v10 node | cloud-init ready in 442 s; public 10/10 after healthy |
| Full chatbot, 50 users, 32 warm GPUs | WebSocket/transcript 50/50; complete voice 41/50; 9 first-chunk 504s; first voice after speech p50 26.54 s/p95 31.64 s; complete response p50 51.85 s/p95 57.94 s |
| Reactive scale-out from 32 | Three 8-request minute waves; alarm after 5m36s; desired 32->43->45; first new healthy capacity 4m20s after launch, all 45 healthy 12m20s after first demand |
| Full chatbot, 50 users, 45 warm GPUs | 50/50 complete; first voice after speech p50 11.62 s/p95 21.00 s; complete response p50 31.25 s/p95 45.20 s |
| Full chatbot, 50 users, 32 route-warmed GPUs | 50/50 complete; turn first-voice p50 7.57/3.79/4.11 s; turn total p50 31.05/27.80/29.02 s; 109.51 s wave |
| Full chatbot, 100 users, 32 route-warmed GPUs | 98/100 complete sessions; all 100 completed turn 1 voice; turn first-voice p50 9.59/4.20/4.12 s; desired stayed 32 because capacity samples retained at least five free slots |
| Closed-loop TTS, 100 users, 32 GPUs, 120 s, verification skipped | 2,427/2,427 valid WAVs; p50 3.86 s/p95 11.31 s; two free slots remained, so no scale |
| Deliberate 192-user saturation | zero-capacity minute at 20:20 SGT; alarm 20:23:43; desired 32->51; 19 launches at 20:23:56; all 19 route-warm checks complete by 20:28:31 |
| Full chatbot, 100 users, 51 hot GPUs | 100/100 complete three-turn sessions; first voice p50 5.02/3.34/3.40 s; total p50 23.54/19.04/17.15 s |
| Full chatbot, 50 users, 51 hot GPUs | 50/50 complete; first voice p50 5.69/4.10/4.30 s; total p50 28.11/25.42/29.30 s |
| Full chatbot, 100 users, newly route-warmed 50 GPUs | 48/100 complete; exactly 50 first-turn TTS requests returned 504; first-audio average 29.60/4.05/3.95 s for users reaching each turn |
| Full chatbot, 150 users, hot 50 GPUs before scale-out | 129/150 complete; first-turn voice 150/150; 21 WebSockets later closed code 1006; first-audio average 10.46/5.51/5.01 s |
| Deliberate 500-user sustained TTS saturation | 9,543 requests; 8,195 valid WAV; 1,323x504 + 25x503; real alarm changed desired 50->80 |
| Full chatbot, 150 users, 80 route-warmed GPUs after scale-out | 150/150 complete; first-audio average 12.43/3.45/3.37 s; no TTS or WebSocket failures |

The complete-flow test command is `node scripts/load-test-staging-chatbot.mjs 50`.
Each virtual user opens an independent public WebSocket, streams a real 24 kHz PCM
question, receives its OpenAI answer, and sequentially sends the answer chunks through
public DeanVoice synthesis. The 32-GPU run averaged 160.6 response words and 10.3
chunks per user; the 45-GPU run averaged 105.7 words and 7.66 chunks. The latter
improvement therefore reflects both additional capacity and shorter generated answers,
not capacity alone. No ALB 503 or Target Optimizer rejection was recorded in the
32-GPU run. The nine failures were CloudFront 504s near 30 seconds on the first voice
chunk while Lambda/backend processing continued for as long as about 36 seconds.

A single earlier chatbot response produced 14 voice chunks sequentially in about
28 seconds. It did not scale because that is one user's one-at-a-time workload and
does not exhaust the fleet. The old completed-request policy was replaced after it
scaled too aggressively from small sustained traffic. The current policy scaled only
when the 192-user trigger produced a zero-capacity sampled minute plus rejected
traffic. The metric minute began at 20:20 SGT, CloudWatch entered ALARM at 20:23:43,
desired changed 32->51, and 19 instances launched at 20:23:56. Their cloud-init,
route-level synthesis warm, inference service, and Target Optimizer checks all
completed between 20:28:28 and 20:28:31. Existing warm targets stayed available.

SSM diagnosis found overlapping cold-start requests could leave an abandoned Python
child alive after the 120-second startup timeout, allowing a retry to launch a second
process on port 9880. Commit `472b44e` kills timed-out children, protects process
ownership from late exit events, and allows five minutes for a true cold boot.
A fresh launch-template instance loaded DeanVoice once, warmed references, produced a
valid 32 kHz WAV, and exposed exactly one API process. Rule 3 now routes to the healthy
optimized target. Three final public chatbot requests returned WAVs in 13.49, 2.10,
and 1.65 seconds. This validates one node, not the planned 16-GPU event capacity.

The earlier undifferentiated ~352-second warm measurement was instrumented in commit
`62f86ff`. On an already initialized node the complete warm command took 13 seconds:
5 seconds GPT cache lookup, 4 seconds SoVITS cache lookup, 1 second pair selection,
and 3 seconds reference/throwaway synthesis. A brand-new v10 instance took 378 seconds
inside the warm command: 9 seconds model-cache lookup, 273 seconds starting the Python
stack and loading GPT/SoVITS/BERT/CNHuBERT, and 96 seconds caching references plus the
first synthesis. Cloud-init finished 442 seconds after boot. The large fresh-instance
difference is consistent with first reads from snapshot-backed EBS blocks; prewarming
must complete before traffic.

Reactive scaling did not increase capacity during a 60-request cold burst: the public
requests timed out before `ALBRequestCountPerTarget` recorded enough completed work,
so desired capacity stayed at one. Scheduled event prewarm is therefore required.
AWS Auto Scaling also requires a finite numeric maximum. The live ASG maximum is now
192, matching the account's verified 768-vCPU On-Demand G/VT quota at four vCPUs per
`g6.xlarge`; this is only a ceiling and does not launch instances. Single-AZ capacity
is not guaranteed.

The 2026-08-02 event is configured for paired one-time actions:
`vcs-staging-prewarm` should set min/desired 50 (max 192) at 07:15 SGT, and
`vcs-staging-scale-down` restores min/desired 1 at 18:00 SGT. Both live actions
were read back and verified on 2026-07-30. The stored UTC times are 2026-08-01 23:15Z and
2026-08-02 10:00Z. Times remain flexible through `VCS_STAGING_PREWARM_AT` and
`VCS_STAGING_SCALE_DOWN_AT`; changing an environment variable alone does nothing
until the provisioner is rerun with `-Apply`. A maximum of 200 would require
800 vCPUs and exceeds the verified quota.

Launch-template v13 keeps Target Optimizer stopped until
`warm-staging-deanvoice.sh` completes. Its live AMI validates one real
`/inference/tts` RIFF after loading weights and warming references. Repository source
now launches two same-model route requests concurrently and requires both RIFF WAVs,
but that change is not live until a new AMI and launch-template version pass fresh-node
validation. Scheduled prewarming remains required.

Capacity retries sent by Lambda carry `X-VCS-Capacity-Retry`; a worker that receives
one inserts it ahead of normal queued work while preserving FIFO within each lane.
This priority applies after Target Optimizer has routed the request. Target Optimizer
rejections happen before the local queue and are retried by Lambda within a bounded
30-second budget.

An intermediate no-reboot AMI (`ami-0b06a87a36a68328d`, launch-template v9) captured
`gpu-inference-worker/src/index.js` as zero bytes and was rolled back before promotion.
The corrected image was created only after verifying the 3,577-byte file and flushing
the filesystem, then validated from a fresh v10 instance before cutover.

### Test method and timing glossary

`scripts/load-test-staging-chatbot.mjs` tests the complete public student flow, not
only the GPU endpoint. Every virtual user opens an independent WebSocket to the exact
staging hostname, waits for `session.ready`, and then all ready users begin together.
Each user streams the same real 24 kHz PCM question at real-time pace, receives an
OpenAI response, splits that response into speakable chunks, and sends the chunks
sequentially through the public DeanVoice endpoint. The harness requires HTTP 200,
`audio/wav`, and a RIFF header for every chunk. Per-user markers in the system prompt
detect response mixing across WebSockets. A user sends the next turn only after all
voice chunks for the current turn finish, matching the website rather than submitting
hundreds of requests at once.

The normal complete-flow command is:

```powershell
$env:VCS_CHATBOT_TURNS='3'
$env:VCS_CHATBOT_REPORT_FILE="$PWD\.tmp\chatbot-report.json"
node scripts/load-test-staging-chatbot.mjs 50
```

For 100 or 150 synchronized virtual users, replace the last argument with `100` or
`150`. Do not open 100-150 browser tabs: tab throttling, shared browser resources,
manual timing, and unsynchronized starts make that a poor load test. Use one to three
real browser tabs only for human listening/UI checks; use the harness for repeatable
capacity measurements.

`scripts/load-test-staging-tts.mjs` isolates the public TTS path. With no duration it
sends one request per virtual user. With `VCS_LOAD_TEST_DURATION_MS`, every virtual
user runs closed-loop: it sends one request, waits for the WAV, and only then sends its
next request. `VCS_LOAD_TEST_TEXT`, `VCS_LOAD_TEST_SKIP_VERIFY`, and
`VCS_LOAD_TEST_REPORT_FILE` control the sentence, verification, and JSON output.
Verification must be stated with every result because skipping it changes service time.

```powershell
$env:VCS_LOAD_TEST_DURATION_MS='120000'
$env:VCS_LOAD_TEST_SKIP_VERIFY='true'
$env:VCS_LOAD_TEST_TEXT='Gastrointestinal bleeding means bleeding somewhere inside the digestive tract, and it needs careful medical assessment.'
$env:VCS_LOAD_TEST_REPORT_FILE="$PWD\.tmp\tts-report.json"
node scripts/load-test-staging-tts.mjs 100
```

Timing fields have different boundaries:

| Field | Starts | Ends | Includes |
|---|---|---|---|
| `speechToTranscript` | Last real speech frame sent | Final user transcript event | WebSocket/gateway/OpenAI transcription only |
| `speechToFirstToken` | Last real speech frame sent | First assistant text token | Conversation response startup |
| `speechToTextDone` | Last real speech frame sent | Complete assistant text event | Transcription plus complete chatbot text generation |
| `firstVoiceChunk` | First public TTS HTTP request | First valid WAV response | Lambda profile resolution, any internal Lambda capacity retries, ALB/Target Optimizer routing, worker queue wait, and GPU synthesis |
| `speechToFirstVoice` | Last real speech frame sent | First valid WAV response | Preferred first-audio measure: conversation work plus first TTS chunk |
| `timeToFirstVoice` | Beginning of streamed user audio | First valid WAV response | Also includes the user's input-audio duration; do not compare it with `speechToFirstVoice` |
| `voiceSynthesis` | First TTS chunk request | Last TTS chunk response | Every response chunk generated sequentially |
| `endToEnd` | Beginning of streamed user audio | Last TTS chunk response | Input duration, conversation, and all voice chunks |
| `wallMs` | Harness starts opening sessions | Last session finishes | Entire test wave, not one user's latency |

The public harness's HTTP timing includes Lambda's internal bounded retry when Target
Optimizer rejects capacity. It does not include the GI browser's separate retry after
an entire public request returns 429/503, because the harness calls `fetch` directly.
A four-to-six-second first chunk therefore *can* contain retry time, but its duration
alone does not prove a retry happened. Use `TargetControlRequestRejectCount`, Lambda
logs, and response status together.

`p50` is the median user; `p95` is the slowest-five-percent boundary. Complete voice
time depends strongly on answer length and chunk count, so compare first-audio time
and response words/chunks before attributing a total-time change to GPU capacity.

### Detailed final test ledger

Corrected route-warm complete-flow results:

| Fleet / users | Turn | Completed | First audio after speech p50 / p95 | First TTS chunk p50 / p95 | Complete response p50 / p95 |
|---|---:|---:|---:|---:|---:|
| 32 GPUs / 50 users | 1 | 50/50 | 7.57 / 9.27 s | 5.34 / 6.93 s | 31.05 / 43.00 s |
| 32 GPUs / 50 users | 2 | 50/50 | 3.79 / 5.26 s | 1.74 / 2.64 s | 27.80 / 38.73 s |
| 32 GPUs / 50 users | 3 | 50/50 | 4.11 / 5.35 s | 1.95 / 2.87 s | 29.02 / 35.75 s |
| 32 GPUs / 100 users | 1 | 100/100 | 9.59 / 15.41 s | 8.25 s p50 | 31.50 / 49.56 s |
| 32 GPUs / 100 users | 2 | 98/100 | 4.20 / 6.36 s | 2.89 s p50 | 24.82 / 38.34 s |
| 32 GPUs / 100 users | 3 | 98/100 | 4.12 / 6.12 s | 2.73 s p50 | 20.71 / 30.52 s |
| 51 hot GPUs / 100 users | 1 | 100/100 | 5.02 / 12.66 s | 3.23 / 10.08 s | 23.54 / 44.41 s |
| 51 hot GPUs / 100 users | 2 | 100/100 | 3.34 / 4.54 s | 1.82 / 2.80 s | 19.04 / 29.68 s |
| 51 hot GPUs / 100 users | 3 | 100/100 | 3.40 / 5.47 s | 1.96 / 3.52 s | 17.15 / 28.41 s |
| 51 hot GPUs / 50 users | 1 | 50/50 | 5.69 / 7.26 s | 3.41 / 4.72 s | 28.11 / 40.71 s |
| 51 hot GPUs / 50 users | 2 | 50/50 | 4.10 / 5.52 s | 1.74 / 2.78 s | 25.42 / 37.39 s |
| 51 hot GPUs / 50 users | 3 | 50/50 | 4.30 / 5.90 s | 1.73 / 3.11 s | 29.30 / 33.12 s |

2026-07-30 event-mode rehearsal, where average is the arithmetic mean and
`endToEnd` runs from the beginning of streamed user audio through the last cloned
voice chunk:

| Fleet / users | Turn | Completed | First audio min / average / p50 / p95 / max | Average end-to-end |
|---|---:|---:|---:|---:|
| Newly route-warmed 50 / 100 | 1 | 50/100 | 12.34 / 29.60 / 32.12 / 33.21 / 33.66 s | 44.12 s |
| Newly route-warmed 50 / 100 | 2 | 48/100 | 2.27 / 4.05 / 3.77 / 5.51 / 5.94 s | 25.23 s |
| Newly route-warmed 50 / 100 | 3 | 48/100 | 2.21 / 3.95 / 3.91 / 5.08 / 5.36 s | 25.59 s |
| Hot 50 / 150, before scale-out | 1 | 150/150 | 6.05 / 10.46 / 8.40 / 18.68 / 27.00 s | 48.92 s |
| Hot 50 / 150, before scale-out | 2 | 131/150 | 3.48 / 5.51 / 5.18 / 8.55 / 10.97 s | 37.13 s |
| Hot 50 / 150, before scale-out | 3 | 129/150 | 2.89 / 5.01 / 4.99 / 6.50 / 7.41 s | 32.46 s |
| Route-warmed 80 / 150, after scale-out | 1 | 150/150 | 5.01 / 12.43 / 7.20 / 27.73 / 30.74 s | 29.97 s |
| Route-warmed 80 / 150, after scale-out | 2 | 150/150 | 2.13 / 3.45 / 3.40 / 4.69 / 14.63 s | 19.86 s |
| Route-warmed 80 / 150, after scale-out | 3 | 150/150 | 1.99 / 3.37 / 3.30 / 4.58 / 6.81 s | 18.01 s |

Wall times were 133.62 seconds for 100/50, 147.06 seconds for the pre-scale
150/50 run, and 102.56 seconds for the post-scale 150/80 run. The first 100-user
wave began immediately after all 50 targets first became healthy and returned exactly
50 first-chunk 504s. A later 150-user wave on the same hot fleet returned first-turn
voice for 150/150, but 21 sessions closed WebSocket code 1006 before completing all
three turns. This inconsistency means 50 cannot be called reliable for the event based
on these tests, even though its later first-turn voice capacity reached 150 users.
The 80-GPU post-scale run is the only one of these three that completed 100%.

The 32-GPU/50-user wall time was 109.51 seconds. The 32-GPU/100-user wall
time was 122.12 seconds. Both incomplete 100-user sessions had already produced valid
turn-one voice and later closed WebSocket code 1006; they were not TTS capacity
timeouts. The hot 51-GPU/100-user wall time was 121.67 seconds and the hot
51-GPU/50-user wall time was 114.14 seconds. No foreign marker was accepted as a
successful session.

Closed-loop saturation results:

| Fleet / virtual users | Hold | Requests | Valid WAV | Failures | Latency p50 / p95 | Capacity/scaling observation |
|---|---:|---:|---:|---:|---:|---|
| 32 / 100, short text, verification skipped | 90 s | 3,186 | 3,186 | 0 | 2.28 / 5.99 s | One-to-two slots still appeared free; no scale |
| 32 / 100, realistic text, verification skipped | 120 s | 2,427 | 2,427 | 0 | 3.86 / 11.31 s | Two slots remained at busiest sample; no scale |
| 32 / 128, realistic text, verification skipped | 240 s | 5,007 | 4,972 | 34x504 + 1x503 | 4.19 / 15.41 s | One slot remained at sampled points; strict rule did not scale |
| 32 / 192, realistic text, verification skipped | 180 s | 3,948 | 3,773 | 173x504 + 2x503 | 4.91 / 21.83 s | Zero-capacity minute; desired 32->51 |
| 50 / 300, realistic text, verification skipped | 180 s | 6,415 | 6,132 | 273x504 + 10x503 | 4.48 / 21.28 s | Sampled free capacity remained; no scale |
| 50 / 500, realistic text, verification skipped | 240 s | 9,543 | 8,195 | 1,323x504 + 25x503 | 7.19 / 25.58 s | Real zero-capacity alarm; desired 50->80 |

The 192-user run was deliberately excessive to verify the strict alarm, not an
accepted user target. Its zero-capacity metric minute began at 20:20 SGT; CloudWatch
entered ALARM at 20:23:43, launch began at 20:23:56, and all 19 new instances passed
cloud-init, inference service, real-route warm, and Target Optimizer checks between
20:28:28 and 20:28:31. This is about 4m32s-4m35s from EC2 launch and about 8m45s
from the beginning of the metric minute. The detection delay includes CloudWatch
metric publication and alarm evaluation, not EC2 startup.

### Warm-up ownership and burst findings

The GI student build does **not** call `/models/select` or send a browser warm request
when a student enters. It reads the pinned `deanvoice-v1` profile and starts the
WebSocket/TTS flow when the student uses chat. The administrative Live page does call
model selection, which loads weights and warms references, but that client flow is not
part of the deployed GI website.

This separation is intentional. If 50 students entering the page each loaded the same
model and sent a throwaway inference, the preparation itself would create a redundant
50-request warm-up burst. Every ASG instance instead prepares once during bootstrap:

1. Start `gpu-inference-worker`.
2. Load/check the pinned GPT and SoVITS weights.
3. Cache the primary reference and five auxiliary references.
4. Run reference/throwaway synthesis.
5. Call the real `/inference/tts` route and require a RIFF WAV.
6. Start Target Optimizer only after every previous step succeeds.

A server-side warm request covers GPU weights, references, and the real worker route.
It does not pre-create every student's WebSocket, OpenAI session, Lambda execution
environment, ALB connection, or unique response text. That is why the first production
turn can be slower even after correct GPU warm-up.

A simultaneous burst can also be slower than a short ramp. Separate EC2 GPUs do not
share compute with each other, but two requests placed on one `g6.xlarge` share that
GPU's compute and memory bandwidth. With 50 users and 32 two-slot GPUs, up to 18 GPUs
may temporarily carry a second user while the remainder carry one. Staggering arrivals
by one or two seconds lets early jobs use more of their GPU before later jobs overlap,
usually improving first-audio p95 and retry pressure at the cost of a longer arrival
window. This should be measured with a controlled 2-5 second ramp rather than assumed.

Target Optimizer is a concurrency gate, not a durable queue. A request rejected at
zero advertised capacity waits inside Lambda before retrying. A slot can finish during
that wait and appear free until the retry returns. ALB/Target Optimizer does not provide
global retry priority; `X-VCS-Capacity-Retry` only moves an admitted retry ahead of
normal entries in that selected worker's local queue. Do not describe the current
system as end-to-end priority.

### Candidate improvements and tradeoffs

The current recommendation for the August event remains scheduled EC2 prewarming plus
the tested bounded retries. The following are post-event experiments, not approved
changes:

| Option | Potential benefit | Downside / risk |
|---|---|---|
| Retry more frequently with 200-500 ms jitter | Reduces short periods where a newly free slot waits for the next Lambda retry | More Lambda/ALB attempts, cost, reject noise, and thundering-herd risk; still no global priority |
| Shared durable priority queue/dispatcher | Buffers bursts and can order retries ahead of new work globally | Changes synchronous TTS into a job API; adds storage, dispatcher availability, fairness/starvation rules, and client polling/WebSocket completion |
| SageMaker Asynchronous Inference | Managed request queue, long jobs, S3 results, and scale-to-zero support | Near-real-time rather than streaming; requires S3 input/output and API redesign, container/model migration, cold-start handling, and cannot provide immediate first audio |
| SageMaker real-time endpoint | Managed model endpoint and autoscaling surface | Still has reactive cold-start delay; requires a compatible serving container and migration from current worker/session contracts; sustained GPU endpoint cost |
| EC2 Auto Scaling warm pool, stopped | Preserves initialized EBS and can use lifecycle hooks before service | Stopping loses RAM/GPU model state, so Python/model reload still occurs; EBS and lifecycle complexity remain; must benchmark against the 272-275 s final AMI |
| EC2 warm pool, running | Near-immediate scale-out | Costs almost the same as active prewarmed GPUs, making the existing schedule simpler |
| Hibernated warm pool | Could preserve RAM where supported | Requires supported instance/AMI configuration, stores RAM on EBS, and GPU/process restoration must be proven; do not assume CUDA state survives correctly |
| EBS Fast Snapshot Restore or deliberate block pre-read | May reduce the snapshot-backed first-read portion of cold start | Extra per-AZ cost and operational work; does not remove Python/model initialization and needs phase-timed proof |
| High-resolution custom capacity metric | Can check utilization every 10 seconds and evaluate a true 30-second window more precisely than the current one-minute sampled Target Optimizer metric | New agent/publisher, CloudWatch cost, missing-data/failure semantics, and alarm maintenance |
| Proactive utilization scale-out | Scale when roughly 50-75% of GPU synthesis slots remain occupied for three consecutive 10-second samples, leaving headroom during the 4.5-minute instance startup instead of waiting for rejected traffic at zero capacity | May launch costly GPUs for short bursts or users who stop immediately; requires a reliable fleet-wide utilization metric, cooldown, and event rehearsal before replacing the strict alarm |
| Multi-AZ private subnets | Better resilience and regional capacity options | Additional NAT/network cost, cache duplication, routing validation, and more infrastructure permissions |
| WebSocket reconnect/resume | Addresses the two code-1006 session losses | Conversation resumption, duplicate-event handling, idempotency, and UI state become more complex |
| One synthesis slot per GPU | More predictable single-user latency | Roughly doubles required GPUs and cost for the same concurrent population |

Future user activity cannot be predicted precisely: users pause between messages,
leave sessions, or submit another turn at different times. A proactive threshold can
therefore reduce cold-start impact, but it should be treated as a headroom policy rather
than a prediction of exact user count.

In this proposal, **busy means an occupied synthesis slot**, not merely an instance
that is powered on. The deployed worker advertises two tested synthesis slots per GPU:
one active generation makes that GPU 50% occupied, while two simultaneous active
generations make it full. Fleet utilization is occupied slots divided by total slots.
For example, 32 GPUs provide 64 slots; 32 simultaneous generations equal 50% fleet
utilization even if they are distributed one per GPU. Queued work should be reported
separately because it indicates demand already exceeds immediately available slots.

The preferred experiment is to publish occupied and total slots every 10 seconds and
scale after three consecutive samples at roughly 50-75% utilization: a real 30-second
window. The current standard one-minute Target Optimizer/CloudWatch metric cannot
reliably implement that exact window and remains unchanged. An absolute trigger such
as 10-30 busy GPUs may be added only as a minimum guard for large fleets; by itself it
would scale too late on a small fleet and too early on a large fleet. Use a slow
scale-in policy, a scale-out cooldown, and compare rejected requests, first-audio
latency, launched GPU-hours, and false scale-outs before promoting this policy.

### Multi-user training and Live Full roadmap

Training and Live Full are not yet horizontally scalable in the same sense as short
DeanVoice inference.

The training worker currently has one bounded FIFO queue stored in process memory and
runs one job at a time on the fixed training GPU. This is safe for concurrent
submissions but is not durable or horizontally distributed: a worker restart loses
queued entries, all users share one failure domain, and wait time grows with each
multi-stage training job.

Two credible training directions should be prototyped after the event:

| Training option | Required work | Benefit | Downside |
|---|---|---|---|
| Durable queue + training ASG/AWS Batch | Put job definitions and status in SQS plus DynamoDB/S3; claim with leases; run one isolated job per GPU; publish checkpoints/progress; autoscale from backlog or estimated GPU-hours | Reuses the current pipeline/container and allows several users to train independently | Queue/lease/idempotency/cancellation complexity, EC2 capacity management, duplicate-job protection, idle GPU cost, and more operational ownership |
| SageMaker Training Jobs | Package the complete GPT-SoVITS/v2ProPlus pipeline, checkpoints, dependencies, input/output contract, metrics, and network/IAM into a training image and submit one managed job per user | Managed job isolation, logs, retries, S3 artifacts, and per-job GPU lifecycle | Container migration effort, startup/cache time, service quotas, potentially higher per-job cost, progress/SSE integration work, and no benefit for real-time inference |

Whichever training platform is selected must use immutable job IDs and per-job S3
prefixes, checkpoint safely, make completion idempotent, support cancellation, enforce
per-user concurrency/cost limits, and never automatically replace the globally active
voice profile. A completed model should become selectable only after artifact and
metadata validation. Queue depth alone is a weak scaling metric when jobs vary greatly;
estimated remaining GPU time is preferable but harder to calculate.

Live Full persists manifests, chunks, previews, finals, cancellation markers, and
events in S3, so another inference target can hydrate a session. However, its synthesis
lease is currently worker-local. Two targets concurrently mutating the same hydrated
session could still race, and initial generation is one long accepted request that
occupies a GPU slot. Before claiming fully distributed Live Full, implement:

1. A distributed session lease with TTL and fencing tokens, or deterministic
   session-to-worker ownership with safe failover. Local scheduler locks are not enough.
2. Conditional manifest revisions and idempotency keys for regenerate/restore/
   insert/delete so stale workers cannot overwrite newer chunk state.
3. Durable asynchronous job state and shared progress delivery. A short REST request
   should enqueue generation and return a session/job ID; browser SSE/WebSocket should
   resume after reconnect without duplicating events.
4. Autoscaling from queued and active estimated GPU work, separated by model/voice
   locality. Raw request count underrepresents a long Full job.
5. Per-user fairness and limits so one long document or repeated regeneration cannot
   occupy every GPU.
6. Optional chunk-level parallelism only after measuring voice consistency. Independent
   chunks can be synthesized on separate GPUs, but final ordering, cancellation,
   retries, loudness normalization, version history, and deterministic reconstruction
   must be reconciled by one coordinator.
7. Failure tests covering worker loss during generation, duplicate delivery, stale
   lease expiry, concurrent edits, model-version changes, S3 delay/failure, and final
   WAV reconstruction.

The simplest first Live Full improvement is distributed lease/version correctness
while keeping one session on one GPU. Parallel chunk generation can reduce total time,
but may introduce inconsistent prosody/voice quality between GPUs, consumes more fleet
capacity per user, and makes regeneration and cancellation substantially more complex.
Do not parallelize chunks merely because shared S3 hydration exists.

AWS references:

- [SageMaker Asynchronous Inference](https://docs.aws.amazon.com/sagemaker/latest/dg/async-inference.html)
- [Autoscale an asynchronous endpoint](https://docs.aws.amazon.com/sagemaker/latest/dg/async-inference-autoscale.html)
- [EC2 Auto Scaling warm pools](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-warm-pools.html)
- [Warm-pool lifecycle hooks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/warm-pool-instance-lifecycle.html)

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

**Confirmed 2026-07-29:** launch-template, target-group-attribute, quota, Lambda, S3,
CloudFront, service-linked-role, ASG, `ssm:SendCommand`, and
`ssm:GetCommandInvocation` access works after assuming the deployment role.
`ssm:DescribeInstanceInformation` remains denied but is not required for command
execution.

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
7. The optimized target group, final AMI `ami-0ffe20a0a5986a0cb`, launch-template v13,
   ASG, one healthy `InService` instance, and zero-capacity scaling policy are live.
   Repository changes for any-rejection scaling and concurrent two-slot route warm are
   locally verified but still require AWS credentials, a new AMI, and fresh-node proof.
   ALB rule 3 routes `/models*`, `/ref-audio*`, and `/inference*` to the optimized
   target. Live paired actions now prewarm 50 GPUs at 07:15 SGT and scale down to
   one at 18:00 SGT for 2026-08-02.
8. Only one NAT-backed private subnet currently exists (`ap-northeast-2a`). A
   production-resilient fleet should add another private subnet/AZ before relying on
   multi-AZ capacity. Route edits are admin-only for this role.
