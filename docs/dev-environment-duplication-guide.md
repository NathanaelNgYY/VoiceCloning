# Dev Environment — Complete System Duplication Guide

**Date:** 2026-07-06 (AWS values verified live via read-only discovery, role `Liu_Teng_Yu_Intern2026`)
**Supersedes/extends:** `docs/superpowers/specs/2026-07-06-dev-staging-environments-design.md` and
`docs/superpowers/plans/2026-07-06-dev-staging-environments.md`.
Adds: the 3rd (chatbot) frontend, private-IP + NAT networking for the dev EC2, EventBridge
idle-stop duplication, and the on-host v2ProPlus specifics discovered on the live EC2.

**Goal:** Duplicate *absolutely everything* in the current live system (hereafter **staging**)
into a parallel **dev** environment: new EC2 (private IP), ALB, Lambda + Function URL,
**three** CloudFront distributions, S3 prefix, EventBridge schedules, IAM.
Staging is never modified (read-only discovery + tagging only).

**How to use this doc:** work top to bottom. Staging values are real (verified 2026-07-06);
`<FILL-IN:*>` placeholders are only for values that *come into existence* as you create the dev
resources — record each one back into the matrix as you go.

## AWS CLI access (how discovery was done / how to run the commands)

Console login lands in identity account `116310094355` (`Identity-Switch-Role`), then
switch-role into the project account. From the CLI, do the same hop:

```powershell
# 1) paste short-lived keys for the identity account (from the SSO/console "Command line access")
# 2) assume the project role:
aws sts assume-role --role-arn arn:aws:iam::329599637774:role/Liu_Teng_Yu_Intern2026 --role-session-name dev-setup
# put the returned keys in a [project] profile; then: $env:AWS_PROFILE='project'
```

**Known permission gaps of `Liu_Teng_Yu_Intern2026`** (verified): `events:*` (ListRules denied),
`scheduler:*`, and `iam:List/Get*` on roles are **denied**. So §6's new-IAM-role step and §9's
EventBridge/Scheduler steps may need the console, an admin, or whoever holds broader creds —
fallback options are given in those sections.

---

## 0. System census (verified 2026-07-06)

### Staging AWS resources — REAL VALUES

| Resource | Value |
|---|---|
| Account | `329599637774` (project) · console entry via `116310094355` Identity-Switch-Role |
| GPU EC2 | `i-03f258d470a2fa73f`, g6.xlarge, az `ap-northeast-2a`, **currently `stopped`**, vol `vol-027be853aeb0ff387` |
| EC2 public IP | **ephemeral — changes every stop/start** (43.201.247.226 was one instance of it). Two *unassociated* EIPs sit in the account: `13.125.17.99` (`eipalloc-0e9c9abc03d2266fd`), `3.36.84.29` (`eipalloc-02f1bc7793de55286`) — currently paying the idle-EIP charge for nothing; use one for the NAT GW in §3 and consider associating the other to staging so its IP stops rotating |
| Key / instance profile | `VoiClo-Gpu-Seoul` / `arn:aws:iam::329599637774:instance-profile/VoiClo_GPU` |
| VPC | `vpc-0b81d044238fcee4d` (10.0.0.0/16) |
| Subnets (only 2, both routed to IGW = public) | `subnet-0692e838cd2e7c7c7` 10.0.0.0/20 2a (instance lives here) · `subnet-02484fe5c859c7d80` 10.0.16.0/20 2b — shared route table `rtb-00e62b711bdd1c978` → `igw-0aba42d46db952e97`; main rtb `rtb-0d344d2f505e5d660` (local only, no subnets) |
| Instance SG | `sg-0806b2491f69f242e` (`VoiClo-Gpu-Seoul-SG`): 22/tcp from `155.69.191.66/32` (NTU), 3001-3003/tcp from ALB SG |
| ALB SG | `sg-0027def934fd4cb8d` (`VoiClo-Gpu-Seoul-ALB-SG`): 80+443 from 0.0.0.0/0; egress 3001-3003 |
| ALB | `voice-gpu-alb` / `voice-gpu-alb-815777974.ap-northeast-2.elb.amazonaws.com`, internet-facing, both subnets, arn `…:loadbalancer/app/voice-gpu-alb/4a1ed7222e5ea097` |
| ALB listener | HTTP :80, arn `…/f682066fe9cb8b87`, default → `voice-gpu-worker` |
| ALB rules | 1: `/api/live/chat/realtime` → `voice-live-gateway` · 2: `/inference/progress/*` → `voice-gpu-worker-inferenc` · 3: `/models*`,`/ref-audio*`,`/inference*` → `voice-gpu-worker-inferenc` · default → `voice-gpu-worker` |
| Target groups (all HTTP, HC `/healthz`, matcher 200, traffic-port) | `voice-gpu-worker` :3001 · `voice-gpu-worker-inferenc` :3003 · `voice-live-gateway` :3002 |
| Lambda | `Liu_Teng_Yu_Intern2026-Voice_Cloning_Project` — nodejs24.x, `index.handler`, 128 MB, 120 s, x86_64, role `Liu_Teng_Yu_Intern2026-LambdaExecutionRole`, logs `/aws/lambda/Liu_Teng_Yu_Intern2026-Voice_Cloning_Project` |
| Function URL | `https://fxeoewfr5wdic5dfxtrlsylonq0bvkdy.lambda-url.ap-northeast-2.on.aws/` — **AuthType `NONE` (public!)**, CORS `*` — repo docs claimed AWS_IAM+OAC; the resource policy still carries the old AWS_IAM statements (scoped to distro E2KTGN0G56FW71 only) plus `FunctionURLAllowPublicAccess`. ⚠️ Security note below |
| Lambda env (non-secret; full key list in §6) | `S3_PREFIX=echolect/`, `GPU_INSTANCE_ID=i-03f258d470a2fa73f`, `GPU_IDLE_STOP_MINUTES=90`, `GPU_SCHEDULE_ENABLED=false` (start 7 / end 19 / Singapore), `LIVE_DEMO_LOCKOUT=false`, `GPU_WORKER_URL=INFERENCE_WORKER_URL=http://voice-gpu-alb-815777974…`, `GPU_WORKER_PUBLIC_URL=https://doovx82fh9tfs.cloudfront.net`, `CORS_ORIGIN=` all three CF domains (note: trailing space present in the live value) |
| EventBridge | rule `VoiClo-gpu-idle-stop` (name recovered from the Lambda resource policy; `events:ListRules` denied — schedule expression assumed `rate(5 minutes)` per repo docs, verify in console) |
| S3 | `s3://interns2026-small-projects-bucket-shared/echolect/` (ap-southeast-1): `audio/ dist/ dist-chatbot/ dist-combined/ dist-live-fast/ dist-training/ models/ pronunciation-dictionary/ sam-artifacts/ training/ voice-profile-configs/ voice-profiles/` + legacy `GPT-SoVITS.zip` (11.9 GB) |

### The three CloudFront distributions — REAL VALUES

Config snapshots saved in-repo: `docs/aws-snapshots/cf-{training,livefast,chatbot}-staging.json`.

| | Training | Live-fast | Chatbot (dean) |
|---|---|---|---|
| Id / domain | `E2KTGN0G56FW71` / d3dghqhnk7aoku | `E36CNBL620DMGM` / doovx82fh9tfs | `EYZ4NLNGITY7T` / d2o0cbe2zunqkr |
| S3 origin path | `/echolect/dist-training` | `/echolect/dist-live-fast` | `/echolect/dist-chatbot` |
| S3 OAC | `E3H8WULM65XB1M` | `E17NIMHGQA3I4G` | `E315ZPZHJRZZYM` |
| Lambda-URL origin | same for all three: `fxeoewfr5wdic5dfxtrlsylonq0bvkdy.lambda-url…`, OAC `EEPE53W4BCAQ8` (`lambda-cloudfront-OAC_V3`) | ← | ← |
| ALB origin | `voice-gpu-alb-815777974…` (no OAC) | ← | ← |
| Behaviors (order) | `/api/*`→Lambda · `/train/progress/*`→ALB · default→S3 | `/api/live/chat/realtime`→ALB · `/api/*`→Lambda · `/inference/progress/*`→ALB · default→S3 | `/api/live/chat/realtime`→ALB · `/train/progress/*`→ALB · `/inference/progress/*`→ALB · `/api/*`→Lambda · default→S3 |
| Error pages | 404→/index.html 200 | none | 403→/index.html 200 · 404→/index.html 200 |

Policies used on the non-default behaviors: cache `4135ea2d-…` (managed **CachingDisabled**);
origin-request `b689b0a8-…` (**AllViewerExceptHostHeader**, on `/api/*`→Lambda) and
`216adef6-…` (**AllViewer**, on ALB paths). Default behavior cache `658327ea-…`
(**CachingOptimized**). All managed policies — nothing custom to recreate.

⚠️ **Security notes found during discovery (fix on dev at least):**
1. Function URL AuthType is `NONE` → the API is publicly invocable *around* CloudFront. Dev should be created with `AWS_IAM` + the OAC pattern (§6/§7), which the docs already describe.
2. The OpenAI key is hardcoded in the staging `voice-live-gateway.service` unit file (§4.5 moves it to an EnvironmentFile on dev; rotate the key eventually).
3. Two unassociated EIPs are billing idle — reuse one for the NAT GW (§3).

### On the staging EC2 (all cloned by the AMI — documented so you know what you're cloning)

- **systemd units** (all `User=ubuntu`):
  - `gpu-worker.service` — port 3001, `WorkingDirectory=/home/ubuntu/VoiceCloning/gpu-worker`, `EnvironmentFile=…/gpu-worker/.env`
  - `gpu-inference-worker.service` — port 3003, `EnvironmentFile=…/gpu-inference-worker/.env`, `ExecStart=/usr/bin/npm start`
  - `voice-live-gateway.service` — port 3002; **env vars hardcoded in the unit file including the OpenAI key** (`Environment=OPENAI_API_KEY=…`). There is *also* `~/VoiceCloning/live-gateway/.env` (OPENAI + GEMINI keys) but unit-file `Environment=` wins. Fix on dev per §4.5.
  - `api-v2.service` — `/opt/gpt-sovits` legacy inference server, **dead/disabled — leave it dead on dev**.
  - Stale errored pm2 `live-gateway` entry (`pm2-ubuntu.service`) — ignore or `pm2 delete live-gateway`.
- **Active GPT-SoVITS:** `~/gpt-sovits-v2pro` — v2ProPlus, upstream `RVC-Boss/GPT-SoVITS` @ `08d627c`, with uncommitted local mods that MUST survive: `GPT_SoVITS/configs/tts_infer.yaml` (custom v2ProPlus weight paths) and `GPT_SoVITS/text/engdict-hot.rep` (1820-line pronunciation hot dict; delete `engdict_cache.pickle` after any dict change). Workers spawn it via `GPT_SOVITS_ROOT=/home/ubuntu/gpt-sovits-v2pro`, `PYTHON_EXEC=/home/ubuntu/miniconda3/envs/gptsovits/bin/python`, API port 9880.
- **Legacy `/opt/gpt-sovits` (20 GB):** still required — both workers use `LOCAL_TEMP_ROOT=/opt/gpt-sovits/worker_temp`, and `tts_infer.yaml`'s custom weights point at `/opt/gpt-sovits/worker_temp/model_cache/DeanVoice-*.{ckpt,pth}`. Keep it in the AMI.
- **Conda:** `~/miniconda3`, env `gptsovits` — faster-whisper 1.2.1, openai-whisper, Resemblyzer 0.1.4 (transcription + speaker-similarity sidecar servers); plus `~/nltk_data`.
- **Repos:** `~/VoiceCloning` on `separate-containers-new` (14 commits ahead of origin — push first, §1); `~/VoiceCloning-v2pro` on `v2proplus-upgrade`.
- **Cron:** `/etc/cron.daily/gpt-sovits-local-cleanup` (model-cache cleanup).
- **Worker env (non-secret) values:** `S3_BUCKET=interns2026-small-projects-bucket-shared`, `S3_REGION=ap-southeast-1`, `S3_PREFIX=echolect/`, `CORS_ORIGIN=<all three CloudFront domains>`, `INFERENCE_PORT=9880`, `TRANSCRIPTION_VERIFY_*`, `SPEAKER_VERIFY_*`.
- **Secrets reused as-is in dev (user decision):** OpenAI Realtime key, Gemini key, gmail `EMAIL_USER`/`EMAIL_PASS` in gpu-worker `.env`.

### Dev value matrix (fill as you create)

| Value | Staging (real) | Dev |
|---|---|---|
| EC2 instance | `i-03f258d470a2fa73f` | `<FILL-IN:dev-instance-id>` / private IP `<FILL-IN:dev-private-ip>` |
| AMI | — | `<FILL-IN:ami-id>` (§4) |
| Private subnet / rtb / NAT | — | `<FILL-IN:dev-private-subnet-id>` / `<FILL-IN:dev-rt-id>` / `<FILL-IN:nat-gw-id>` (§3) |
| Dev GPU SG | `sg-0806b2491f69f242e` (staging) | `<FILL-IN:dev-gpu-sg-id>` (§3) |
| ALB | voice-gpu-alb-815777974… | `<FILL-IN:dev-alb-dns>` / `<FILL-IN:dev-alb-arn>` (§5) |
| Lambda / URL | Liu_Teng_Yu_Intern2026-Voice_Cloning_Project / fxeoewfr…on.aws | `…-dev` / `<FILL-IN:dev-function-url-domain>` (§6) |
| CF training | E2KTGN0G56FW71 / d3dghqhnk7aoku | `<FILL-IN:dev-training-distro-id>` / `<FILL-IN:dev-training-domain>` |
| CF live-fast | E36CNBL620DMGM / doovx82fh9tfs | `<FILL-IN:dev-livefast-distro-id>` / `<FILL-IN:dev-livefast-domain>` |
| CF chatbot | EYZ4NLNGITY7T / d2o0cbe2zunqkr | `<FILL-IN:dev-chatbot-distro-id>` / `<FILL-IN:dev-chatbot-domain>` |
| S3 prefix | `echolect/` | `echolect-dev/` |
| Branches | `separate-containers-new` + `chatbot-live-full` | `develop` + `develop-chatbot` |
| Idle-stop | rule `VoiClo-gpu-idle-stop` → staging Lambda | `<FILL-IN:dev-idle-rule>` (§9) |
| Nightly stop | — | `vcs-dev-gpu-nightly-stop` (§9) |

---

## 1. Pre-snapshot prep (on the staging EC2 — read-only + git push)

The instance is stopped by default now — start it first, and remember the public IP will be
NEW (not 43.201.247.226):

```powershell
aws ec2 start-instances --region ap-northeast-2 --instance-ids i-03f258d470a2fa73f
aws ec2 describe-instances --region ap-northeast-2 --instance-ids i-03f258d470a2fa73f --query "Reservations[0].Instances[0].PublicIpAddress" --output text
```

```bash
ssh -i "VoiClo-Gpu-Seoul.pem" ubuntu@<current-public-ip>     # SSH only works from 155.69.191.66 (NTU) per the SG
cd ~/VoiceCloning
git status
git log --oneline origin/separate-containers-new..HEAD   # the ~14 unpushed commits
git push origin separate-containers-new
# record the v2pro local mods so a rebuilt box could reproduce them
cd ~/gpt-sovits-v2pro
git diff GPT_SoVITS/configs/tts_infer.yaml > ~/v2pro-local-mods.patch
cp GPT_SoVITS/text/engdict-hot.rep ~/engdict-hot.rep.$(date +%F).bak
```

Confirm the pipeline is idle (no training job, no inference in flight):
`curl -s localhost:3001/api/training/status`. Worker state is in-memory, so an idle
no-reboot snapshot is clean.

---

## 2. Branches

```powershell
git fetch origin
git checkout separate-containers-new; git pull
git checkout -b develop; git push -u origin develop
git checkout chatbot-live-full; git pull
git checkout -b develop-chatbot; git push -u origin develop-chatbot
```

Flow: feature → `develop` → verified on dev env → merge into `separate-containers-new`
(staging). Chatbot frontend work: `develop-chatbot` → `chatbot-live-full`.

---

## 3. Dev networking (private IP + NAT — dev-only topology difference)

Staging's two subnets are both public (shared `rtb-00e62b711bdd1c978` → `igw-0aba42d46db952e97`).
Dev gets a **new private subnet**. Outbound internet (OpenAI Realtime, npm/apt/pip) flows via a
NAT Gateway; regional AWS API traffic can bypass it via a free S3 Gateway endpoint.

VPC is `10.0.0.0/16` with `10.0.0.0/20` and `10.0.16.0/20` taken → use **`10.0.32.0/20`**:

```powershell
# 3.1 private subnet (2a, same AZ as the ALB/instance)
aws ec2 create-subnet --region ap-northeast-2 --vpc-id vpc-0b81d044238fcee4d --cidr-block 10.0.32.0/20 --availability-zone ap-northeast-2a --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=vcs-dev-private},{Key=Environment,Value=dev}]"
# 3.2 NAT gateway in a PUBLIC subnet — REUSE the idle EIP eipalloc-0e9c9abc03d2266fd (13.125.17.99)
aws ec2 create-nat-gateway --region ap-northeast-2 --subnet-id subnet-0692e838cd2e7c7c7 --allocation-id eipalloc-0e9c9abc03d2266fd --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=vcs-dev-nat},{Key=Environment,Value=dev}]"
aws ec2 wait nat-gateway-available --region ap-northeast-2 --nat-gateway-ids <FILL-IN:nat-gw-id>
# 3.3 private route table: 0.0.0.0/0 -> NAT
aws ec2 create-route-table --region ap-northeast-2 --vpc-id vpc-0b81d044238fcee4d --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=vcs-dev-private-rt},{Key=Environment,Value=dev}]"
aws ec2 create-route --region ap-northeast-2 --route-table-id <FILL-IN:dev-rt-id> --destination-cidr-block 0.0.0.0/0 --nat-gateway-id <FILL-IN:nat-gw-id>
aws ec2 associate-route-table --region ap-northeast-2 --route-table-id <FILL-IN:dev-rt-id> --subnet-id <FILL-IN:dev-private-subnet-id>
# 3.4 S3 Gateway endpoint (free). NOTE: the data bucket is in ap-southeast-1, so bucket traffic
# still crosses region via the NAT; the endpoint only helps regional S3/AWS calls. Keep it anyway.
aws ec2 create-vpc-endpoint --region ap-northeast-2 --vpc-id vpc-0b81d044238fcee4d --service-name com.amazonaws.ap-northeast-2.s3 --vpc-endpoint-type Gateway --route-table-ids <FILL-IN:dev-rt-id>
# 3.5 dev GPU SG: 3001-3003 from the ALB SG only (no SSH rule needed — no public IP; use SSM)
aws ec2 create-security-group --region ap-northeast-2 --vpc-id vpc-0b81d044238fcee4d --group-name vcs-dev-gpu-sg --description "dev GPU instance" --tag-specifications "ResourceType=security-group,Tags=[{Key=Environment,Value=dev}]"
aws ec2 authorize-security-group-ingress --region ap-northeast-2 --group-id <FILL-IN:dev-gpu-sg-id> --protocol tcp --port 3001-3003 --source-group sg-0027def934fd4cb8d
```

The dev ALB (§5) reuses staging's ALB SG `sg-0027def934fd4cb8d`, so the ingress rule above
covers both ALBs and no staging SG is modified.

**Host access without a public IP — SSM Session Manager:**

```powershell
aws ssm start-session --region ap-northeast-2 --target <FILL-IN:dev-instance-id>
```

Requires `AmazonSSMManagedInstanceCore` on the `VoiClo_GPU` instance-profile role. IAM reads
are denied to your CLI role, so check in the **console** (IAM → Roles → the `VoiClo_GPU` role →
attached policies); the SSM agent itself is already on the box (snap `amazon-ssm-agent` seen
running). If the policy is missing, attach it via console/admin. Fallback: temporarily add a
public IP to the dev instance and SSH from NTU (mirroring staging's SSH rule), then remove it.

---

## 4. AMI + dev EC2

The AMI clones everything in §0's on-host census in one step — CUDA, conda, GPT-SoVITS +
pretrained models, hot dict, systemd units, both repos — nothing re-downloads.

```powershell
# 4.1 snapshot (no reboot; pipeline confirmed idle in §1; instance can even be stopped = cleanest)
aws ec2 create-image --region ap-northeast-2 --instance-id i-03f258d470a2fa73f --name "vcs-staging-2026-07-06" --description "Voice Cloning staging clone for dev env" --no-reboot --tag-specifications "ResourceType=image,Tags=[{Key=Environment,Value=dev}]"
aws ec2 wait image-available --region ap-northeast-2 --image-ids <FILL-IN:ami-id>   # 10-20+ min
# 4.2 launch into the PRIVATE subnet, no public IP
aws ec2 run-instances --region ap-northeast-2 --image-id <FILL-IN:ami-id> --instance-type g6.xlarge --subnet-id <FILL-IN:dev-private-subnet-id> --security-group-ids <FILL-IN:dev-gpu-sg-id> --key-name VoiClo-Gpu-Seoul --iam-instance-profile Name=VoiClo_GPU --no-associate-public-ip-address --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=voice-gpu-dev},{Key=Environment,Value=dev}]" --count 1
aws ec2 wait instance-running --region ap-northeast-2 --instance-ids <FILL-IN:dev-instance-id>
```

On-host configuration (via SSM session, §3):

```bash
# 4.3 point workers at the dev prefix (CORS gets real dev domains in §8)
sudo sed -i 's|^S3_PREFIX=echolect/|S3_PREFIX=echolect-dev/|' \
  /home/ubuntu/VoiceCloning/gpu-worker/.env /home/ubuntu/VoiceCloning/gpu-inference-worker/.env
# 4.4 security cleanup: move voice-live-gateway env out of the unit file
sudo systemctl edit --full voice-live-gateway
#   -> delete the Environment= lines, add: EnvironmentFile=/home/ubuntu/VoiceCloning/live-gateway/.env
#   (that .env already has OPENAI_API_KEY, GEMINI_API_KEY; ensure it also has PORT=3002,
#    NODE_ENV=production, CORS_ORIGIN, OPENAI_REALTIME_MODEL=gpt-realtime, OPENAI_REALTIME_VAD=semantic_vad)
# 4.5 clean legacy leftovers
sudo systemctl disable --now api-v2 2>/dev/null; pm2 delete live-gateway 2>/dev/null; pm2 save
# 4.6 switch the repo to develop
cd ~/VoiceCloning && git fetch origin && git checkout develop && git pull
# 4.7 restart + verify (incl. python sidecars starting)
sudo systemctl daemon-reload
sudo systemctl restart gpu-worker gpu-inference-worker voice-live-gateway
curl -s localhost:3001/healthz; curl -s localhost:3003/healthz; curl -s localhost:3002/healthz
curl -s localhost:3001/readyz;  curl -s localhost:3003/readyz
```

Expected: all `/healthz` 200; `/readyz` 200 (503 = env/config error — read the body).

---

## 5. Dev ALB (internet-facing, public subnets, targets the private-IP instance)

Mirror staging exactly: 3 TGs (HTTP, HC `/healthz`, matcher 200) + 3 listener rules.

```powershell
aws elbv2 create-target-group --region ap-northeast-2 --name vcs-dev-tg-3001 --protocol HTTP --port 3001 --vpc-id vpc-0b81d044238fcee4d --health-check-path /healthz --target-type instance
aws elbv2 create-target-group --region ap-northeast-2 --name vcs-dev-tg-3003 --protocol HTTP --port 3003 --vpc-id vpc-0b81d044238fcee4d --health-check-path /healthz --target-type instance
aws elbv2 create-target-group --region ap-northeast-2 --name vcs-dev-tg-3002 --protocol HTTP --port 3002 --vpc-id vpc-0b81d044238fcee4d --health-check-path /healthz --target-type instance
aws elbv2 register-targets --region ap-northeast-2 --target-group-arn <each-dev-tg-arn> --targets Id=<FILL-IN:dev-instance-id>

aws elbv2 create-load-balancer --region ap-northeast-2 --name voice-gpu-alb-dev --subnets subnet-0692e838cd2e7c7c7 subnet-02484fe5c859c7d80 --security-groups sg-0027def934fd4cb8d --tags Key=Environment,Value=dev
aws elbv2 create-listener --region ap-northeast-2 --load-balancer-arn <FILL-IN:dev-alb-arn> --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=<dev-tg-3001-arn>
aws elbv2 create-rule --region ap-northeast-2 --listener-arn <FILL-IN:dev-listener-arn> --priority 1 --conditions Field=path-pattern,Values=/api/live/chat/realtime --actions Type=forward,TargetGroupArn=<dev-tg-3002-arn>
aws elbv2 create-rule --region ap-northeast-2 --listener-arn <FILL-IN:dev-listener-arn> --priority 2 --conditions "Field=path-pattern,Values=/inference/progress/*" --actions Type=forward,TargetGroupArn=<dev-tg-3003-arn>
aws elbv2 create-rule --region ap-northeast-2 --listener-arn <FILL-IN:dev-listener-arn> --priority 3 --conditions "Field=path-pattern,Values=/models*,/ref-audio*,/inference*" --actions Type=forward,TargetGroupArn=<dev-tg-3003-arn>
# verify
aws elbv2 describe-target-health --region ap-northeast-2 --target-group-arn <each-dev-tg-arn>   # expect healthy
Invoke-RestMethod http://<FILL-IN:dev-alb-dns>/healthz
```

---

## 6. Dev Lambda (role + function + Function URL)

**Role:** creating `vcs-lambda-dev` needs `iam:CreateRole`, which your CLI role likely lacks
(IAM reads are denied). Options, best first:
1. Create the role in the **console** (or ask an admin) with the trust+policy below.
2. Fallback: reuse staging's `Liu_Teng_Yu_Intern2026-LambdaExecutionRole` for the dev function.
   Works immediately but loses the isolation guarantee (dev Lambda could touch `echolect/` and
   the staging instance) — acceptable short-term, revisit later.

Trust: `lambda.amazonaws.com`. Policy (scoped to dev):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject"], "Resource": "arn:aws:s3:::interns2026-small-projects-bucket-shared/echolect-dev/*" },
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::interns2026-small-projects-bucket-shared", "Condition": { "StringLike": { "s3:prefix": "echolect-dev/*" } } },
    { "Effect": "Allow", "Action": ["ec2:StartInstances","ec2:StopInstances"], "Resource": "arn:aws:ec2:ap-northeast-2:329599637774:instance/<FILL-IN:dev-instance-id>" },
    { "Effect": "Allow", "Action": "ec2:DescribeInstances", "Resource": "*" },
    { "Effect": "Allow", "Action": ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], "Resource": "*" }
  ]
}
```

(If staging's role has extras — e.g. SES for the training-complete email — copy those too;
view its policies in the console since CLI IAM reads are denied.)

**Function** (config mirrors staging exactly: nodejs24.x / index.handler / 128 MB / 120 s / x86_64):

```powershell
cd lambda; npm run package:function-url
aws lambda create-function --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev --runtime nodejs24.x --handler index.handler --memory-size 128 --timeout 120 --role <dev-role-arn> --zip-file fileb://.dist/voice-cloning-function-url.zip --tags Environment=dev
```

**Env vars** — full key set from staging (19 keys). Values: copy staging's, changing only the
marked ones. Read staging's exact values with:
`aws lambda get-function-configuration --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project --query Environment.Variables`

```
ARTIFACT_SOURCE=s3                MODEL_SOURCE=s3
S3_BUCKET=interns2026-small-projects-bucket-shared
S3_REGION=ap-southeast-1
S3_PREFIX=echolect-dev/                          # CHANGED
GPU_INSTANCE_ID=<FILL-IN:dev-instance-id>        # CHANGED
GPU_INSTANCE_REGION=ap-northeast-2
GPU_IDLE_STOP_MINUTES=30                         # CHANGED (staging=90; dev stops sooner)
GPU_SCHEDULE_ENABLED=false  GPU_SCHEDULE_START_HOUR=7  GPU_SCHEDULE_END_HOUR=19  GPU_SCHEDULE_TIMEZONE=Singapore
GPU_WORKER_URL=http://<FILL-IN:dev-alb-dns>      # CHANGED
INFERENCE_WORKER_URL=http://<FILL-IN:dev-alb-dns>  # CHANGED
GPU_WORKER_PUBLIC_URL=https://placeholder-until-§8   # CHANGED in §8
CORS_ORIGIN=https://placeholder-until-§8             # CHANGED in §8
LIVE_DEMO_LOCKOUT=false
VOICE_PROFILE_INTERNAL_AUTH_HEADER_NAME=<copy staging>   VOICE_PROFILE_INTERNAL_AUTH_HEADER_VALUE=<copy staging>
```

**Function URL — create it with `AWS_IAM` (fixing staging's public-URL hole on dev):**

```powershell
aws lambda create-function-url-config --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev --auth-type AWS_IAM
```

Smoke: unsigned `Invoke-WebRequest https://<FILL-IN:dev-function-url-domain>/api/models` must
return **403** (proves function + IAM URL exist). If the frontends later fail on POST via
CloudFront, verify the client sends `x-amz-content-sha256` (it does — `client/src/services/api.js`)
and the `/api/*` behavior forwards it (AllViewerExceptHostHeader does). Escape hatch: switch the
dev URL to `NONE` like staging, but then the "public API" caveat applies to dev too.

---

## 7. Three dev CloudFront distributions

Start from the in-repo snapshots `docs/aws-snapshots/cf-{training,livefast,chatbot}-staging.json`
(taken 2026-07-06; re-snapshot with `aws cloudfront get-distribution-config --id <Id>` if staging
changed since). For each, produce a dev copy with exactly these changes, then create:

1. Drop the `ETag` wrapper; keep only the inner `DistributionConfig`.
2. `CallerReference` → new GUID (`[guid]::NewGuid().ToString()`).
3. `Comment` → e.g. `"Training Voice Cloning - DEV"`; `Aliases` stays `{"Quantity":0}` (already no aliases).
4. Origins:
   - Lambda-URL origin domain → `<FILL-IN:dev-function-url-domain>`; **keep OAC `EEPE53W4BCAQ8`** —
     with the dev URL on AWS_IAM the OAC signing is what authenticates CloudFront.
   - ALB origin domain → `<FILL-IN:dev-alb-dns>`.
   - S3 origin: same bucket domain, `OriginPath` → `/echolect-dev/dist-training` |
     `/echolect-dev/dist-live-fast` | `/echolect-dev/dist-chatbot`. Keep each distro's S3 OAC
     (`E3H8WULM65XB1M` / `E17NIMHGQA3I4G` / `E315ZPZHJRZZYM` — OACs are reusable).
5. Everything else byte-identical — behavior order and the managed policy IDs listed in §0
   (CachingDisabled + AllViewerExceptHostHeader on `/api/*`; CachingDisabled + AllViewer on ALB
   paths; the chatbot distro's 403+404→index.html error pages; training's 404→index.html).

```powershell
aws cloudfront create-distribution --distribution-config file://cf-training-dev.json    # ×3
aws cloudfront tag-resource --resource arn:aws:cloudfront::329599637774:distribution/<dev-distro-id> --tags "Items=[{Key=Environment,Value=dev}]"
# allow each dev distro to invoke the dev Function URL (AWS_IAM + OAC pattern)
aws lambda add-permission --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev --statement-id cf-training-dev --action lambda:InvokeFunctionUrl --principal cloudfront.amazonaws.com --function-url-auth-type AWS_IAM --source-arn arn:aws:cloudfront::329599637774:distribution/<FILL-IN:dev-training-distro-id>
# repeat with cf-livefast-dev / cf-chatbot-dev
aws cloudfront wait distribution-deployed --id <each-dev-distro-id>
```

**S3 bucket policy:** the shared bucket's policy must allow the three dev distro ARNs for the
S3 OACs to work. Check the existing policy (`aws s3api get-bucket-policy --bucket
interns2026-small-projects-bucket-shared --region ap-southeast-1`) — if it lists staging distro
ARNs under `AWS:SourceArn`, append the three dev ARNs (coordinate with the bucket owner — it's
the org-shared interns bucket).

---

## 8. Wire-up + seed

```powershell
# 8.1 real dev domains into the dev Lambda (rerun the §6 env update changing only):
#   CORS_ORIGIN=https://<dev-training-domain>,https://<dev-livefast-domain>,https://<dev-chatbot-domain>
#   GPU_WORKER_PUBLIC_URL=https://<dev-livefast-domain>
# 8.2 seed dev data once (drifts independently after). Excludes the client dist folders on
#     purpose? No — include them so the frontends work before the first deploy; deploy scripts
#     overwrite them later. Skip the 12GB legacy zip:
aws s3 sync s3://interns2026-small-projects-bucket-shared/echolect/ s3://interns2026-small-projects-bucket-shared/echolect-dev/ --region ap-southeast-1 --exclude "GPT-SoVITS.zip"
```

On the dev host (SSM):

```bash
sudo sed -i 's|^CORS_ORIGIN=.*|CORS_ORIGIN=https://<dev-training-domain>,https://<dev-livefast-domain>,https://<dev-chatbot-domain>|' \
  /home/ubuntu/VoiceCloning/gpu-worker/.env /home/ubuntu/VoiceCloning/gpu-inference-worker/.env /home/ubuntu/VoiceCloning/live-gateway/.env
sudo systemctl restart gpu-worker gpu-inference-worker voice-live-gateway
```

---

## 9. Schedules / automation

⚠️ Your CLI role is **denied** `events:*` and `scheduler:*` — do this section in the console,
or have an admin run the CLI. Staging's rule is `VoiClo-gpu-idle-stop` (rate every 5 min per
repo docs — verify in console: EventBridge → Rules).

**9.1 Dev idle-stop rule** — mirror staging: schedule `rate(5 minutes)`, target = the dev
Lambda with constant input `{"rawPath":"/api/instance/idle-check","requestContext":{"http":{"method":"POST"}}}`,
plus the Lambda permission:

```powershell
aws events put-rule --region ap-northeast-2 --name vcs-dev-gpu-idle-stop --schedule-expression "rate(5 minutes)"
aws lambda add-permission --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev --statement-id AllowEventBridgeGpuIdleStopDev --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:ap-northeast-2:329599637774:rule/vcs-dev-gpu-idle-stop
aws events put-targets --region ap-northeast-2 --rule vcs-dev-gpu-idle-stop --targets "Id=1,Arn=arn:aws:lambda:ap-northeast-2:329599637774:function:Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev,Input='{\"rawPath\":\"/api/instance/idle-check\",\"requestContext\":{\"http\":{\"method\":\"POST\"}}}'"
```

**9.2 Nightly stop backstop** (21:00 KST = 12:00 UTC) — EventBridge Scheduler,
role trusted by `scheduler.amazonaws.com` with only `ec2:StopInstances` on the dev instance:

```powershell
aws scheduler create-schedule --region ap-northeast-2 --name vcs-dev-gpu-nightly-stop --schedule-expression "cron(0 12 * * ? *)" --flexible-time-window "Mode=OFF" --target "Arn=arn:aws:scheduler:::aws-sdk:ec2:stopInstances,RoleArn=<scheduler-role-arn>,Input='{\"InstanceIds\":[\"<FILL-IN:dev-instance-id>\"]}'"
```

Verify by temporarily setting the cron a few minutes ahead, confirming the stop, restoring,
and restarting the instance. If Scheduler is unavailable even in console, the idle-stop rule
alone (with dev's 30-min threshold) is an acceptable interim safety net.

---

## 10. Deploy scripts + per-env client env files

Create `scripts/deploy.config.json` (staging values are final; dev values from the matrix):

```json
{
  "dev": {
    "lambdaFunction": "Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev",
    "region": "ap-northeast-2", "s3Region": "ap-southeast-1",
    "instanceId": "<FILL-IN:dev-instance-id>", "branch": "develop", "chatbotBranch": "develop-chatbot",
    "distributions": { "training": "<dev-training-distro-id>", "live-fast": "<dev-livefast-distro-id>", "chatbot": "<dev-chatbot-distro-id>" },
    "clientTargets": {
      "training": "s3://interns2026-small-projects-bucket-shared/echolect-dev/dist-training",
      "live-fast": "s3://interns2026-small-projects-bucket-shared/echolect-dev/dist-live-fast",
      "chatbot": "s3://interns2026-small-projects-bucket-shared/echolect-dev/dist-chatbot" }
  },
  "staging": {
    "lambdaFunction": "Liu_Teng_Yu_Intern2026-Voice_Cloning_Project",
    "region": "ap-northeast-2", "s3Region": "ap-southeast-1",
    "instanceId": "i-03f258d470a2fa73f", "branch": "separate-containers-new", "chatbotBranch": "chatbot-live-full",
    "distributions": { "training": "E2KTGN0G56FW71", "live-fast": "E36CNBL620DMGM", "chatbot": "EYZ4NLNGITY7T" },
    "clientTargets": {
      "training": "s3://interns2026-small-projects-bucket-shared/echolect/dist-training",
      "live-fast": "s3://interns2026-small-projects-bucket-shared/echolect/dist-live-fast",
      "chatbot": "s3://interns2026-small-projects-bucket-shared/echolect/dist-chatbot" }
  }
}
```

Scripts (PowerShell 5.1 — no `&&`, no ternary):

- `scripts/deploy-client.ps1 -Env dev|staging -Mode training|live-fast|chatbot [-DryRun]` —
  copies `client/env/<env>/<mode>.env` to `client/.env.<mode>.local` (Vite loads `.local`
  above `.env.<mode>`; no client code changes), runs `npm run build:<mode>`, syncs `dist-<mode>`
  to `clientTargets.<mode>`, invalidates `distributions.<mode>`. **Chatbot mode must build from
  a `develop-chatbot` (dev) / `chatbot-live-full` (staging) checkout/worktree** — the script
  should refuse if `git branch --show-current` doesn't match `chatbotBranch`.
- `scripts/deploy-lambda.ps1 -Env dev|staging` — `npm run package:function-url` then
  `aws lambda update-function-code` on `lambdaFunction`.
- `scripts/deploy-worker.ps1 -Env dev|staging` — staging: SSH (fetch the current public IP
  first, it rotates); dev: SSM (`aws ssm send-command --instance-ids <dev-instance-id>
  --document-name AWS-RunShellScript`) running: `cd /home/ubuntu/VoiceCloning; git fetch;
  git checkout <branch>; git pull; sudo systemctl restart gpu-worker gpu-inference-worker
  voice-live-gateway` + healthz curls.

Per-env client env files — `client/env/{dev,staging}/{training,live-fast,chatbot}.env`
(staging files copy today's values verbatim from `client/.env.training` / `.env.live-fast` /
chatbot values in `chatbot-live-full`'s `.env.chatbot`; dev files point every URL at the
matching dev CloudFront domain), e.g. `client/env/dev/chatbot.env`:

```
VITE_APP_MODE=chatbot
VITE_APP_BASENAME=/
VITE_API_BASE_URL=https://<dev-chatbot-domain>
VITE_GPU_WORKER_URL=https://<dev-chatbot-domain>
VITE_LIVE_GATEWAY_URL=https://<dev-chatbot-domain>
VITE_CHATBOT_VOICE_PROFILE_ID=DeanVoice
```

(The chatbot distro has its own `/api/live/chat/realtime` → ALB behavior, so it stays
same-origin — no cross-domain gateway URL needed.)

Dry-run all combinations and check no dev command mentions a staging resource and vice versa.

---

## 11. Verification checklist (end-to-end)

1. **Training frontend** `https://<dev-training-domain>`: voice list loads (Lambda → S3
   `echolect-dev/` + CORS); upload short audio → first training step (Slice) with live SSE.
2. **TTS inference** on a seeded voice runs to completion — including the ASR word-coverage
   gate (faster-whisper) and speaker-similarity gate (Resemblyzer), proving the conda sidecars
   survived the AMI.
3. **Live-fast frontend** `https://<dev-livefast-domain>`: live chat session, spoken reply
   (WSS `/api/live/chat/realtime` → dev ALB → gateway 3002 → OpenAI via NAT).
4. **Chatbot frontend** `https://<dev-chatbot-domain>`: page loads, DeanVoice auto-selected,
   live chat speaks.
5. **Stop/start resilience:** stop the dev instance; frontend shows GPU-stopped state
   gracefully; start; ALB target healthy again; inference works.
6. **Idle-stop:** leave dev idle >30 min → instance stops (needs §9.1 live).
7. **Staging untouched:** all three staging URLs still work; staging Lambda
   `LastModified` predates this work; staging EIPs/SGs/rules unchanged.

---

## 12. Runbooks + cost + cleanup notes

**Start/stop dev GPU:**

```powershell
aws ec2 start-instances --region ap-northeast-2 --instance-ids <FILL-IN:dev-instance-id>
aws ec2 stop-instances  --region ap-northeast-2 --instance-ids <FILL-IN:dev-instance-id>
```

(Auto: idle-stop after 30 min via dev Lambda + §9.1 rule; nightly stop 21:00 KST via §9.2.)

**Deploy to dev:** `deploy-lambda.ps1 -Env dev`; `deploy-client.ps1 -Env dev -Mode <m>`;
`deploy-worker.ps1 -Env dev`. **Promote:** merge `develop` → `separate-containers-new`
(and `develop-chatbot` → `chatbot-live-full`), rerun scripts with `-Env staging`.

**Ongoing cost:** NAT Gateway ~$0.059/hr ≈ $43/mo + $0.059/GB processed (all dev S3 data
crosses it — the bucket is in another region); dev ALB ~$20/mo; dev EBS ~500 GB gp3 ~$40/mo
while stopped; g6.xlarge ~$1.13/hr while running. EIP for NAT is free once attached (and it
was billing idle before). If NAT cost matters later, the cheaper alternative is a public IP +
strict SG (staging's model) — private-IP was the chosen design.

**Security cleanup (dev fixes them; staging follow-ups):**
1. Staging Function URL is `AuthType NONE` (publicly invocable around CloudFront) — dev is built with AWS_IAM (§6); consider flipping staging after verifying dev's OAC path works.
2. OpenAI key hardcoded in staging's `voice-live-gateway.service` unit — fixed on dev (§4.4); rotate the key and fix staging in a quiet window.
3. Associate the second idle EIP (`3.36.84.29`) to staging or release it — it bills while unassociated, and pinning staging's IP would also stabilize SSH.
