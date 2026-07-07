# Staging Environment — Complete Architecture Reference

**Environment:** `staging` (the stable copy for users; development happens on `dev`)
**Region:** ap-northeast-2 (Seoul) · **Account:** 329599637774 · **Last verified live:** 2026-07-07

> **Keep this file up to date.** Any change to staging infra (console, CLI, or script) must be reflected here in the same PR/commit. Every ID below was read from AWS on the date above — an AI session can diff this file against `aws describe-*` output to detect drift.
>
> Related docs: `docs/staging-environment-handoff.md` (how it was built + admin backlog), `docs/dev-environment-duplication-guide.md` (step-by-step build recipe; note its "dev" naming means today's "staging").

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

**Services on the box** (systemd, code at `/home/ubuntu/VoiceCloning`, branch `separate-containers-new` on disk):

| Port | systemd unit | Role | Env file |
|---|---|---|---|
| 3001 | `gpu-worker` | training/cloning worker | `gpu-worker/.env` (`S3_PREFIX=echolect-staging/`, staging CORS) |
| 3002 | `voice-live-gateway` | realtime live-chat gateway (OpenAI realtime API) | `live-gateway/.env` (holds `OPENAI_API_KEY`, `PORT=3002`, `OPENAI_REALTIME_MODEL=gpt-realtime`, `OPENAI_REALTIME_VAD=semantic_vad`, staging CORS) |
| 3003 | `gpu-inference-worker` | TTS inference worker | `gpu-inference-worker/.env` (same S3/CORS changes) |

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
| GPU_WORKER_URL, INFERENCE_WORKER_URL | `http://voice-gpu-alb-staging-1031778835.ap-northeast-2.elb.amazonaws.com` |
| GPU_WORKER_PUBLIC_URL | `https://dfzrfr93t2ruf.cloudfront.net` |
| CORS_ORIGIN | the 3 staging CloudFront domains (comma-separated) |
| S3_BUCKET / S3_PREFIX / S3_REGION | `interns2026-small-projects-bucket-shared` / `echolect-staging/` / ap-southeast-1 |
| ARTIFACT_SOURCE / MODEL_SOURCE | s3 / s3 |
| LIVE_DEMO_LOCKOUT | false |
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

## 10. Known gaps / pending admin work (as of 2026-07-07)

1. **Idle-stop EventBridge rule `vcs-staging-gpu-idle-stop` does not exist yet** — GPU must be stopped manually (g6.xlarge ≈ $1/hr). Commands in `docs/staging-environment-handoff.md` §BLOCKED-2.
2. Leftover `voice-gpu-alb-dev` (`…/app/voice-gpu-alb-dev/17b83508f5602cd7`) + `vcs-dev-tg-3001/3002/3003` to delete (~$20/mo, serves nothing — artifact of the early naming flip).
3. Both Lambda Function URLs (dev + staging) are public (`NONE`) — harden to AWS_IAM + CloudFront OAC.
4. Rotate the OpenAI API key (it lived in the dev box's unit file; staging keeps it in `live-gateway/.env`).
5. Optional: scoped `vcs-lambda-staging` exec role instead of the shared one.
6. Ask admin whether NAT gateways get auto-cleaned — whitelist `nat-0dadc68ca781b8df9` (see §5 history).
