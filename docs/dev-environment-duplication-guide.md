# Dev Environment — Complete System Duplication Guide

**Date:** 2026-07-06
**Supersedes/extends:** `docs/superpowers/specs/2026-07-06-dev-staging-environments-design.md` and
`docs/superpowers/plans/2026-07-06-dev-staging-environments.md`.
Adds: the 3rd (chatbot) frontend, private-IP + NAT networking for the dev EC2, EventBridge
idle-stop duplication, and the on-host v2ProPlus specifics discovered on the live EC2.

**Goal:** Duplicate *absolutely everything* in the current live system (hereafter **staging**)
into a parallel **dev** environment: new EC2 (private IP), ALB, Lambda + Function URL,
**three** CloudFront distributions, S3 prefix, EventBridge schedules, CloudWatch, IAM.
Staging is never modified (read-only discovery + tagging only).

**How to use this doc:** work top to bottom. Every `<FILL-IN:*>` placeholder has a discovery
command right next to it — run the command (with fresh AWS creds), paste the value back into
this doc, then run the mutation commands. Regions: compute = `ap-northeast-2` (Seoul),
S3 = `ap-southeast-1`.

---

## 0. System census (what "everything" is)

### Staging AWS resources

| Resource | Value |
|---|---|
| Account | 329599637774 |
| GPU EC2 (staging) | `i-03f258d470a2fa73f`, g6.xlarge (NVIDIA L4), public IP 43.201.247.226, key `VoiClo-Gpu-Seoul.pem` |
| VPC / SG | `vpc-0b81d044238fcee4d` / `sg-0806b2491f69f242e`, public subnets in 2a/2b |
| ALB | `voice-gpu-alb` (`voice-gpu-alb-815777974.ap-northeast-2.elb.amazonaws.com`), HTTP :80 |
| Target groups | `voice-gpu-worker` (3001, default), `voice-gpu-inference-worker` (3003, `/models*` `/ref-audio*` `/inference*`), `voice-live-gateway` (3002, `/api/live/chat/realtime`) |
| Lambda | `Liu_Teng_Yu_Intern2026-Voice_Cloning_Project`; Function URL `fxeoewfr5wdic5dfxtrlsylonq0bvkdy.lambda-url.ap-northeast-2.on.aws`, AuthType `AWS_IAM` behind CloudFront OAC |
| CloudFront ×3 | training `d3dghqhnk7aoku` (`E2KTGN0G56FW71`) · live-fast `doovx82fh9tfs` · chatbot/dean `d2o0cbe2zunqkr` |
| S3 | `s3://interns2026-small-projects-bucket-shared/echolect/` (data + `dist-training/`, `dist-live-fast/`, `dist-chatbot/` client bundles), region ap-southeast-1 |
| EventBridge | idle-stop rule invoking Lambda `/api/instance/idle-check` every 5 min (see §9 discovery) |

### On the staging EC2 (all cloned by the AMI — documented so you know what you're cloning)

- **systemd units** (all `User=ubuntu`):
  - `gpu-worker.service` — port 3001, `WorkingDirectory=/home/ubuntu/VoiceCloning/gpu-worker`, `EnvironmentFile=…/gpu-worker/.env`
  - `gpu-inference-worker.service` — port 3003, `EnvironmentFile=…/gpu-inference-worker/.env`, `ExecStart=/usr/bin/npm start`
  - `voice-live-gateway.service` — port 3002; **env vars are hardcoded in the unit file including the OpenAI key** (`Environment=OPENAI_API_KEY=…`). There is *also* `~/VoiceCloning/live-gateway/.env` (OPENAI + GEMINI keys) but unit-file `Environment=` wins. ⚠️ Security cleanup: on the dev box, move these to `EnvironmentFile=` (§4 step 5).
  - `api-v2.service` — `/opt/gpt-sovits` legacy inference server, **dead/disabled — leave it dead on dev**.
  - Stale errored pm2 `live-gateway` entry (`pm2-ubuntu.service`) — ignore or `pm2 delete live-gateway`.
- **Active GPT-SoVITS:** `~/gpt-sovits-v2pro` — v2ProPlus, upstream `RVC-Boss/GPT-SoVITS` @ `08d627c`, with uncommitted local mods that MUST survive: `GPT_SoVITS/configs/tts_infer.yaml` (custom v2ProPlus weight paths) and `GPT_SoVITS/text/engdict-hot.rep` (1820-line pronunciation hot dict; delete `engdict_cache.pickle` after any dict change). Workers spawn it via `GPT_SOVITS_ROOT=/home/ubuntu/gpt-sovits-v2pro`, `PYTHON_EXEC=/home/ubuntu/miniconda3/envs/gptsovits/bin/python`, API port 9880.
- **Legacy `/opt/gpt-sovits` (20 GB):** still required — both workers use `LOCAL_TEMP_ROOT=/opt/gpt-sovits/worker_temp`, and `tts_infer.yaml`'s custom weights point at `/opt/gpt-sovits/worker_temp/model_cache/DeanVoice-*.{ckpt,pth}`. Keep it in the AMI.
- **Conda:** `~/miniconda3`, env `gptsovits` — faster-whisper 1.2.1, openai-whisper, Resemblyzer 0.1.4 (transcription + speaker-similarity sidecar servers); plus `~/nltk_data`.
- **Repos:** `~/VoiceCloning` on `separate-containers-new` (14 commits ahead of origin — push first, §1); `~/VoiceCloning-v2pro` on `v2proplus-upgrade`.
- **Cron:** `/etc/cron.daily/gpt-sovits-local-cleanup` (model-cache cleanup).
- **Worker env (non-secret) values:** `S3_BUCKET=interns2026-small-projects-bucket-shared`, `S3_REGION=ap-southeast-1`, `S3_PREFIX=echolect/`, `CORS_ORIGIN=<all three CloudFront domains>`, `INFERENCE_PORT=9880`, `TRANSCRIPTION_VERIFY_*`, `SPEAKER_VERIFY_*`.
- **Secrets reused as-is in dev (user decision):** OpenAI Realtime key, Gemini key, gmail `EMAIL_USER`/`EMAIL_PASS` in gpu-worker `.env`.

### Dev environment name/value matrix (fill as you go)

| Value | Staging | Dev |
|---|---|---|
| EC2 instance | `i-03f258d470a2fa73f` (public IP) | `<FILL-IN:dev-instance-id>` (private IP `<FILL-IN:dev-private-ip>`) |
| AMI | — | `<FILL-IN:ami-id>` (§4) |
| Private subnet / NAT GW | — (public subnet) | `<FILL-IN:dev-private-subnet-id>` / `<FILL-IN:nat-gw-id>` (§3) |
| ALB | voice-gpu-alb-815777974… | `<FILL-IN:dev-alb-dns>` (§5) |
| Lambda | Liu_Teng_Yu_Intern2026-Voice_Cloning_Project | `…-dev`, URL `<FILL-IN:dev-function-url-domain>` (§6) |
| CloudFront training | d3dghqhnk7aoku / E2KTGN0G56FW71 | `<FILL-IN:dev-training-domain>` / `<FILL-IN:dev-training-distro-id>` |
| CloudFront live-fast | doovx82fh9tfs / `<FILL-IN:livefast-distro-id>` | `<FILL-IN:dev-livefast-domain>` / `<FILL-IN:dev-livefast-distro-id>` |
| CloudFront chatbot | d2o0cbe2zunqkr / `<FILL-IN:chatbot-distro-id>` | `<FILL-IN:dev-chatbot-domain>` / `<FILL-IN:dev-chatbot-distro-id>` |
| S3 prefix | `echolect/` | `echolect-dev/` |
| Branches | `separate-containers-new` (+ `chatbot-live-full` frontend) | `develop` (+ `develop-chatbot` frontend) |
| Idle-stop | EventBridge rule `<FILL-IN:idle-rule-name>` | dev copy (§9) |
| Nightly stop | — | `vcs-dev-gpu-nightly-stop` (§9) |

Discovery for staging distro IDs:

```powershell
aws cloudfront list-distributions --query "DistributionList.Items[].{Id:Id,Domain:DomainName}" --output table
```

---

## 1. Pre-snapshot prep (on the staging EC2 — read-only + git push)

```bash
ssh -i "VoiClo-Gpu-Seoul.pem" ubuntu@43.201.247.226
cd ~/VoiceCloning
git status                      # expect clean or only ignored files
git log --oneline origin/separate-containers-new..HEAD   # the ~14 unpushed commits
git push origin separate-containers-new
```

Record the local mods in `~/gpt-sovits-v2pro` so a rebuilt box could reproduce them:

```bash
cd ~/gpt-sovits-v2pro
git diff GPT_SoVITS/configs/tts_infer.yaml > ~/v2pro-local-mods.patch
cp GPT_SoVITS/text/engdict-hot.rep ~/engdict-hot.rep.$(date +%F).bak
```

Confirm the pipeline is idle (no training job running, no inference in flight) — check the
training tab of the app, or `curl -s localhost:3001/api/training/status`. Worker state is
in-memory, so an idle no-reboot snapshot is clean.

---

## 2. Branches

Two long-lived dev branches (backend/main frontends vs chatbot frontend):

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

Staging uses a public IP; dev deliberately uses a **private subnet**. Outbound internet is
still required (OpenAI Realtime API from the live gateway, npm/apt/pip), provided by a NAT
Gateway. S3 traffic bypasses the NAT via a free Gateway VPC endpoint.

Discovery:

```powershell
aws ec2 describe-subnets --region ap-northeast-2 --filters Name=vpc-id,Values=vpc-0b81d044238fcee4d --query "Subnets[].{Id:SubnetId,Cidr:CidrBlock,Az:AvailabilityZone,Public:MapPublicIpOnLaunch}" --output table
aws ec2 describe-route-tables --region ap-northeast-2 --filters Name=vpc-id,Values=vpc-0b81d044238fcee4d --query "RouteTables[].{Id:RouteTableId,Assoc:Associations[].SubnetId,Routes:Routes[].GatewayId}"
```

Pick a free CIDR (e.g. `10.0.16.0/24` — adjust to the VPC's plan) and a public subnet
`<FILL-IN:public-subnet-id>` for the NAT:

```powershell
# 3.1 private subnet
aws ec2 create-subnet --region ap-northeast-2 --vpc-id vpc-0b81d044238fcee4d --cidr-block <FILL-IN:free-cidr> --availability-zone ap-northeast-2a --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=vcs-dev-private},{Key=Environment,Value=dev}]"
# 3.2 NAT gateway (+ EIP) in a PUBLIC subnet
aws ec2 allocate-address --region ap-northeast-2 --domain vpc
aws ec2 create-nat-gateway --region ap-northeast-2 --subnet-id <FILL-IN:public-subnet-id> --allocation-id <FILL-IN:eip-alloc-id> --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=vcs-dev-nat},{Key=Environment,Value=dev}]"
aws ec2 wait nat-gateway-available --region ap-northeast-2 --nat-gateway-ids <FILL-IN:nat-gw-id>
# 3.3 private route table: 0.0.0.0/0 -> NAT, associate with the private subnet
aws ec2 create-route-table --region ap-northeast-2 --vpc-id vpc-0b81d044238fcee4d --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=vcs-dev-private-rt},{Key=Environment,Value=dev}]"
aws ec2 create-route --region ap-northeast-2 --route-table-id <FILL-IN:dev-rt-id> --destination-cidr-block 0.0.0.0/0 --nat-gateway-id <FILL-IN:nat-gw-id>
aws ec2 associate-route-table --region ap-northeast-2 --route-table-id <FILL-IN:dev-rt-id> --subnet-id <FILL-IN:dev-private-subnet-id>
# 3.4 S3 Gateway endpoint (free; S3 is in ap-southeast-1 so this covers only regional calls —
# cross-region S3 traffic still goes via NAT; keep the endpoint anyway for regional AWS APIs)
aws ec2 create-vpc-endpoint --region ap-northeast-2 --vpc-id vpc-0b81d044238fcee4d --service-name com.amazonaws.ap-northeast-2.s3 --vpc-endpoint-type Gateway --route-table-ids <FILL-IN:dev-rt-id>
```

**Dev security group** (ALB → app ports only; no public SSH since there's no public IP):

```powershell
aws ec2 create-security-group --region ap-northeast-2 --vpc-id vpc-0b81d044238fcee4d --group-name vcs-dev-gpu-sg --description "dev GPU instance" --tag-specifications "ResourceType=security-group,Tags=[{Key=Environment,Value=dev}]"
# allow 3001/3002/3003 from the ALB SG (reuse staging ALB SG id or the new dev ALB SG from §5)
aws ec2 authorize-security-group-ingress --region ap-northeast-2 --group-id <FILL-IN:dev-gpu-sg-id> --protocol tcp --port 3001-3003 --source-group <FILL-IN:alb-sg-id>
```

**Host access without a public IP — use SSM Session Manager** (recommended over a bastion):
the instance profile must include `AmazonSSMManagedInstanceCore` (check what the staging
profile has: `aws iam list-attached-role-policies --role-name <FILL-IN:instance-profile-role>`,
discovered in §4). Then:

```powershell
aws ssm start-session --region ap-northeast-2 --target <FILL-IN:dev-instance-id>
# or port-forwarded SSH:
aws ssm start-session --region ap-northeast-2 --target <FILL-IN:dev-instance-id> --document-name AWS-StartSSHSession
```

---

## 4. AMI + dev EC2

The AMI clones everything in §0's on-host census in one step — CUDA, conda, GPT-SoVITS +
pretrained models (4.6 GB), hot dict, systemd units, both repos — nothing re-downloads.

```powershell
# 4.1 discovery: staging instance details (profile, key, volumes)
aws ec2 describe-instances --region ap-northeast-2 --instance-ids i-03f258d470a2fa73f --query "Reservations[0].Instances[0].{Type:InstanceType,Subnet:SubnetId,SGs:SecurityGroups,Key:KeyName,Profile:IamInstanceProfile.Arn,Volumes:BlockDeviceMappings}"
# 4.2 snapshot (no reboot; pipeline confirmed idle in §1)
aws ec2 create-image --region ap-northeast-2 --instance-id i-03f258d470a2fa73f --name "vcs-staging-2026-07-06" --description "Voice Cloning staging clone for dev env" --no-reboot --tag-specifications "ResourceType=image,Tags=[{Key=Environment,Value=dev}]"
aws ec2 wait image-available --region ap-northeast-2 --image-ids <FILL-IN:ami-id>   # 10-20 min for ~80GB used
# 4.3 launch into the PRIVATE subnet, no public IP
aws ec2 run-instances --region ap-northeast-2 --image-id <FILL-IN:ami-id> --instance-type g6.xlarge --subnet-id <FILL-IN:dev-private-subnet-id> --security-group-ids <FILL-IN:dev-gpu-sg-id> --key-name <FILL-IN:key-name> --iam-instance-profile Arn=<FILL-IN:instance-profile-arn> --no-associate-public-ip-address --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=voice-gpu-dev},{Key=Environment,Value=dev}]" --count 1
aws ec2 wait instance-running --region ap-northeast-2 --instance-ids <FILL-IN:dev-instance-id>
```

On-host configuration (via SSM session, §3):

```bash
# 4.4 point workers at the dev prefix (CORS gets real dev domains in §8)
sudo sed -i 's|^S3_PREFIX=echolect/|S3_PREFIX=echolect-dev/|' \
  /home/ubuntu/VoiceCloning/gpu-worker/.env /home/ubuntu/VoiceCloning/gpu-inference-worker/.env
# 4.5 security cleanup: move voice-live-gateway env out of the unit file
sudo systemctl edit --full voice-live-gateway
#   -> delete the Environment= lines, add: EnvironmentFile=/home/ubuntu/VoiceCloning/live-gateway/.env
#   (that .env already exists with OPENAI_API_KEY, GEMINI_API_KEY etc.; add PORT=3002, NODE_ENV=production,
#    CORS_ORIGIN, OPENAI_REALTIME_MODEL=gpt-realtime, OPENAI_REALTIME_VAD=semantic_vad if missing)
# 4.6 clean legacy leftovers
sudo systemctl disable --now api-v2 2>/dev/null; pm2 delete live-gateway 2>/dev/null; pm2 save
# 4.7 switch the repo to develop
cd ~/VoiceCloning && git fetch origin && git checkout develop && git pull
# 4.8 restart + verify (incl. python sidecars starting)
sudo systemctl restart gpu-worker gpu-inference-worker voice-live-gateway
curl -s localhost:3001/healthz; curl -s localhost:3003/healthz; curl -s localhost:3002/healthz
curl -s localhost:3001/readyz;  curl -s localhost:3003/readyz
```

Expected: all `/healthz` 200; `/readyz` 200 (503 = env/config error — read the body).

---

## 5. Dev ALB (internet-facing, public subnets, targets the private-IP instance)

An internet-facing ALB in the public subnets can target an instance in a private subnet —
that's the standard pattern and exactly why dev can be private-IP.

```powershell
# discovery: staging listener rules + TG health checks to mirror
aws elbv2 describe-load-balancers --region ap-northeast-2 --names voice-gpu-alb --query "LoadBalancers[0].{Arn:LoadBalancerArn,Subnets:AvailabilityZones[].SubnetId,SGs:SecurityGroups}"
aws elbv2 describe-listeners --region ap-northeast-2 --load-balancer-arn <FILL-IN:staging-alb-arn>
aws elbv2 describe-rules --region ap-northeast-2 --listener-arn <FILL-IN:staging-listener-arn>
aws elbv2 describe-target-groups --region ap-northeast-2 --load-balancer-arn <FILL-IN:staging-alb-arn> --query "TargetGroups[].{Name:TargetGroupName,Port:Port,Health:HealthCheckPath}"

# create 3 TGs (expected: 3001 default, 3003 /models* /ref-audio* /inference*, 3002 /api/live/chat/realtime; verify against discovery)
aws elbv2 create-target-group --region ap-northeast-2 --name vcs-dev-tg-3001 --protocol HTTP --port 3001 --vpc-id vpc-0b81d044238fcee4d --health-check-path <FILL-IN:hc-3001> --target-type instance
aws elbv2 create-target-group --region ap-northeast-2 --name vcs-dev-tg-3003 --protocol HTTP --port 3003 --vpc-id vpc-0b81d044238fcee4d --health-check-path <FILL-IN:hc-3003> --target-type instance
aws elbv2 create-target-group --region ap-northeast-2 --name vcs-dev-tg-3002 --protocol HTTP --port 3002 --vpc-id vpc-0b81d044238fcee4d --health-check-path /healthz --target-type instance
aws elbv2 register-targets --region ap-northeast-2 --target-group-arn <each-dev-tg-arn> --targets Id=<FILL-IN:dev-instance-id>

# ALB + listener + rules (mirror staging rules verbatim, same priority order)
aws elbv2 create-load-balancer --region ap-northeast-2 --name voice-gpu-alb-dev --subnets <FILL-IN:public-subnet-2a> <FILL-IN:public-subnet-2b> --security-groups <FILL-IN:alb-sg-id> --tags Key=Environment,Value=dev
aws elbv2 create-listener --region ap-northeast-2 --load-balancer-arn <FILL-IN:dev-alb-arn> --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=<FILL-IN:dev-tg-3001-arn>
aws elbv2 create-rule --region ap-northeast-2 --listener-arn <FILL-IN:dev-listener-arn> --priority 1 --conditions Field=path-pattern,Values=/api/live/chat/realtime --actions Type=forward,TargetGroupArn=<FILL-IN:dev-tg-3002-arn>
aws elbv2 create-rule --region ap-northeast-2 --listener-arn <FILL-IN:dev-listener-arn> --priority 2 --conditions "Field=path-pattern,Values=/models*,/ref-audio*,/inference*" --actions Type=forward,TargetGroupArn=<FILL-IN:dev-tg-3003-arn>
# verify
aws elbv2 describe-target-health --region ap-northeast-2 --target-group-arn <each-dev-tg-arn>   # expect healthy
Invoke-RestMethod http://<FILL-IN:dev-alb-dns>/healthz
```

Remember to allow the ALB SG into the dev GPU SG on 3001–3003 (§3).

---

## 6. Dev Lambda (scoped role + function + Function URL)

```powershell
# discovery: staging function config + role policies (copy any extras, e.g. SES)
aws lambda get-function-configuration --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project --query "{Runtime:Runtime,Handler:Handler,Mem:MemorySize,Timeout:Timeout,Role:Role,Env:Environment.Variables}"
aws iam list-attached-role-policies --role-name <FILL-IN:staging-lambda-role-name>
aws iam list-role-policies --role-name <FILL-IN:staging-lambda-role-name>
```

Role `vcs-lambda-dev` — trust `lambda.amazonaws.com`; inline policy scoped to dev:

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

Add any extra statements the staging role has (SES for the training-complete email, etc.),
re-scoped to dev where applicable.

```powershell
aws iam create-role --role-name vcs-lambda-dev --assume-role-policy-document file://$env:TEMP/lambda-trust.json --tags Key=Environment,Value=dev
aws iam put-role-policy --role-name vcs-lambda-dev --policy-name vcs-lambda-dev-scope --policy-document file://$env:TEMP/lambda-dev-policy.json

cd lambda; npm run package:function-url
aws lambda create-function --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev --runtime <FILL-IN:staging-runtime> --handler <FILL-IN:staging-handler> --memory-size <FILL-IN:staging-mem> --timeout <FILL-IN:staging-timeout> --role arn:aws:iam::329599637774:role/vcs-lambda-dev --zip-file fileb://.dist/voice-cloning-function-url.zip --tags Environment=dev
```

**Env vars** — start from the staging function's full env map (discovery above; local
reference `lambda/.env.deployment` is only a subset — code also reads `INFERENCE_WORKER_URL`,
`INFERENCE_WORKER_PUBLIC_URL`, `GPU_SCHEDULE_ENABLED/START_HOUR/END_HOUR/TIMEZONE`,
`VOICE_PROFILE_INTERNAL_AUTH_HEADER_NAME/VALUE`, `LIVE_DEMO_LOCKOUT`, `DEMO_CLOUDFRONT_HOST`).
Change only:

```
S3_PREFIX=echolect-dev/
GPU_INSTANCE_ID=<FILL-IN:dev-instance-id>
GPU_WORKER_URL=http://<FILL-IN:dev-alb-dns>
INFERENCE_WORKER_URL=http://<FILL-IN:dev-alb-dns>
GPU_WORKER_PUBLIC_URL=https://placeholder-until-§8
CORS_ORIGIN=https://placeholder-until-§8
GPU_IDLE_STOP_MINUTES=30        # primary dev cost control; §9 nightly stop is the backstop
```

```powershell
aws lambda update-function-configuration --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev --environment "Variables={...full map...}"
aws lambda create-function-url-config --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev --auth-type AWS_IAM
```

Smoke: unsigned `Invoke-WebRequest https://<FILL-IN:dev-function-url-domain>/api/models` must
return **403** (proves function + IAM URL exist; not a timeout/5xx).

---

## 7. Three dev CloudFront distributions

```powershell
# discovery: save all three staging configs + list OACs
aws cloudfront get-distribution-config --id E2KTGN0G56FW71 > "$env:TEMP\cf-training-staging.json"
aws cloudfront get-distribution-config --id <FILL-IN:livefast-distro-id> > "$env:TEMP\cf-livefast-staging.json"
aws cloudfront get-distribution-config --id <FILL-IN:chatbot-distro-id> > "$env:TEMP\cf-chatbot-staging.json"
aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[].{Id:Id,Name:Name,Type:OriginAccessControlOriginType}"
```

For each saved config produce a dev copy with exactly these changes, then create:

1. Drop the `ETag` wrapper; keep only the inner `DistributionConfig`.
2. `CallerReference` → new GUID (`[guid]::NewGuid().ToString()`).
3. `Comment` → `"vcs <training|livefast|chatbot> dev"`; `Aliases` → `{"Quantity":0}`.
4. Origins: Lambda-URL origin → `<FILL-IN:dev-function-url-domain>`; ALB origin →
   `<FILL-IN:dev-alb-dns>`; S3 client origin path → `/echolect-dev/dist-training`,
   `/echolect-dev/dist-live-fast`, `/echolect-dev/dist-chatbot` respectively.
   Keep the same `OriginAccessControlId`s (OACs are reusable across distributions).
5. Everything else byte-identical (behavior order — `/api/live/chat/realtime` above `/api/*` —
   cache/origin-request policies, error pages).

```powershell
aws cloudfront create-distribution --distribution-config file://$env:TEMP/cf-training-dev.json    # repeat ×3
aws cloudfront tag-resource --resource arn:aws:cloudfront::329599637774:distribution/<dev-distro-id> --tags "Items=[{Key=Environment,Value=dev}]"
# each dev distro must be allowed to invoke the dev Function URL:
aws lambda add-permission --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev --statement-id cf-training-dev --action lambda:InvokeFunctionUrl --principal cloudfront.amazonaws.com --source-arn arn:aws:cloudfront::329599637774:distribution/<FILL-IN:dev-training-distro-id>
# (repeat with cf-livefast-dev / cf-chatbot-dev statement ids)
# if the S3 bucket policy restricts by AWS:SourceArn, append the three dev distro ARNs to it (check with the bucket owner — it's the shared interns bucket)
aws cloudfront wait distribution-deployed --id <each-dev-distro-id>
```

---

## 8. Wire-up + seed

```powershell
# 8.1 real dev domains into the dev Lambda (rerun §6 env update with all values, changing:)
#   CORS_ORIGIN=https://<dev-training-domain>,https://<dev-livefast-domain>,https://<dev-chatbot-domain>
#   GPU_WORKER_PUBLIC_URL=https://<dev-livefast-domain>   (and INFERENCE_WORKER_PUBLIC_URL likewise)
# 8.2 seed dev data once (drifts independently after)
aws s3 sync s3://interns2026-small-projects-bucket-shared/echolect/ s3://interns2026-small-projects-bucket-shared/echolect-dev/ --region ap-southeast-1
```

On the dev host (SSM):

```bash
sudo sed -i 's|^CORS_ORIGIN=.*|CORS_ORIGIN=https://<dev-training-domain>,https://<dev-livefast-domain>,https://<dev-chatbot-domain>|' \
  /home/ubuntu/VoiceCloning/gpu-worker/.env /home/ubuntu/VoiceCloning/gpu-inference-worker/.env /home/ubuntu/VoiceCloning/live-gateway/.env
sudo systemctl restart gpu-worker gpu-inference-worker voice-live-gateway
```

---

## 9. Schedules / automation

```powershell
# discovery: the staging idle-stop rule + target (EventBridge classic)
aws events list-rules --region ap-northeast-2 --query "Rules[].{Name:Name,Sched:ScheduleExpression,State:State}"
aws events list-targets-by-rule --region ap-northeast-2 --rule <FILL-IN:idle-rule-name>
```

**9.1 Dev idle-stop rule** (mirror staging: rate 5 min → dev Lambda with
`{"rawPath":"/api/instance/idle-check","requestContext":{"http":{"method":"POST"}}}` input):

```powershell
aws events put-rule --region ap-northeast-2 --name vcs-dev-gpu-idle-stop --schedule-expression "rate(5 minutes)"
aws lambda add-permission --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev --statement-id AllowEventBridgeGpuIdleStopDev --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:ap-northeast-2:329599637774:rule/vcs-dev-gpu-idle-stop
aws events put-targets --region ap-northeast-2 --rule vcs-dev-gpu-idle-stop --targets "Id=1,Arn=<FILL-IN:dev-lambda-arn>,Input='{\"rawPath\":\"/api/instance/idle-check\",\"requestContext\":{\"http\":{\"method\":\"POST\"}}}'"
```

**9.2 Nightly stop backstop** (21:00 KST = 12:00 UTC), EventBridge Scheduler with a
`scheduler.amazonaws.com`-trusted role allowing only `ec2:StopInstances` on the dev instance:

```powershell
aws iam create-role --role-name vcs-dev-scheduler --assume-role-policy-document file://$env:TEMP/scheduler-trust.json --tags Key=Environment,Value=dev
aws iam put-role-policy --role-name vcs-dev-scheduler --policy-name stop-dev-gpu --policy-document file://$env:TEMP/scheduler-policy.json
aws scheduler create-schedule --region ap-northeast-2 --name vcs-dev-gpu-nightly-stop --schedule-expression "cron(0 12 * * ? *)" --flexible-time-window "Mode=OFF" --target "Arn=arn:aws:scheduler:::aws-sdk:ec2:stopInstances,RoleArn=arn:aws:iam::329599637774:role/vcs-dev-scheduler,Input='{\"InstanceIds\":[\"<FILL-IN:dev-instance-id>\"]}'"
```

Verify by temporarily setting the cron a few minutes ahead, confirming the stop, restoring,
and restarting the instance.

---

## 10. Deploy scripts + per-env client env files

Create `scripts/deploy.config.json` (all values from the §0 matrix):

```json
{
  "dev": {
    "lambdaFunction": "Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev",
    "region": "ap-northeast-2", "s3Region": "ap-southeast-1",
    "instanceId": "<FILL-IN:dev-instance-id>", "branch": "develop", "chatbotBranch": "develop-chatbot",
    "distributions": { "training": "<dev-training-distro-id>", "live-fast": "<dev-livefast-distro-id>", "chatbot": "<dev-chatbot-distro-id>" },
    "clientTargets": { "training": "s3://interns2026-small-projects-bucket-shared/echolect-dev/dist-training", "live-fast": ".../echolect-dev/dist-live-fast", "chatbot": ".../echolect-dev/dist-chatbot" }
  },
  "staging": {
    "lambdaFunction": "Liu_Teng_Yu_Intern2026-Voice_Cloning_Project",
    "region": "ap-northeast-2", "s3Region": "ap-southeast-1",
    "instanceId": "i-03f258d470a2fa73f", "branch": "separate-containers-new", "chatbotBranch": "chatbot-live-full",
    "distributions": { "training": "E2KTGN0G56FW71", "live-fast": "<livefast-distro-id>", "chatbot": "<chatbot-distro-id>" },
    "clientTargets": { "training": "s3://interns2026-small-projects-bucket-shared/echolect/dist-training", "live-fast": ".../echolect/dist-live-fast", "chatbot": ".../echolect/dist-chatbot" }
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
- `scripts/deploy-worker.ps1 -Env dev|staging` — staging: SSH to 43.201.247.226; dev: SSM
  (`aws ssm send-command --instance-ids <dev-instance-id> --document-name AWS-RunShellScript`)
  running: `cd /home/ubuntu/VoiceCloning; git fetch; git checkout <branch>; git pull;
  sudo systemctl restart gpu-worker gpu-inference-worker voice-live-gateway;` + healthz curls.

Per-env client env files — nine total, `client/env/{dev,staging}/{training,live-fast,chatbot}.env`
(staging files copy today's values verbatim from `client/.env.training` / `.env.live-fast` /
chatbot values in `chatbot-live-full`'s `.env.chatbot`; dev files point every URL at the
matching dev CloudFront domain), e.g. `client/env/dev/chatbot.env`:

```
VITE_APP_MODE=chatbot
VITE_APP_BASENAME=/
VITE_API_BASE_URL=https://<dev-chatbot-domain>
VITE_GPU_WORKER_URL=https://<dev-chatbot-domain>
VITE_LIVE_GATEWAY_URL=https://<dev-livefast-domain>
VITE_CHATBOT_VOICE_PROFILE_ID=DeanVoice
```

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
6. **Idle-stop:** leave dev idle >30 min → instance stops (EventBridge + Lambda idle-check).
7. **Staging untouched:** all three staging URLs still work; staging Lambda
   `LastModified` predates this work; staging instance still running.

---

## 12. Runbooks + cost + cleanup notes

**Start/stop dev GPU:**

```powershell
aws ec2 start-instances --region ap-northeast-2 --instance-ids <FILL-IN:dev-instance-id>
aws ec2 stop-instances  --region ap-northeast-2 --instance-ids <FILL-IN:dev-instance-id>
```

(Auto: idle-stop after 30 min; nightly stop 21:00 KST.)

**Deploy to dev:** `deploy-lambda.ps1 -Env dev`; `deploy-client.ps1 -Env dev -Mode <m>`;
`deploy-worker.ps1 -Env dev`. **Promote:** merge `develop` → `separate-containers-new`
(and `develop-chatbot` → `chatbot-live-full`), rerun scripts with `-Env staging`.

**Ongoing cost:** NAT Gateway ~$40/mo + data processing; dev ALB ~$20/mo; EBS ~500 GB
~$40/mo while stopped; g6.xlarge ~$1/hr only while running. If NAT cost matters, the
cheaper alternative is a public IP + strict SG on the dev box — but private-IP was the
chosen design.

**Security cleanup:** the staging `voice-live-gateway.service` unit file hardcodes the
OpenAI key — fixed on dev in §4.5; consider the same change on staging during a quiet
window, and rotate the key since it has been sitting in a world-readable unit file.
