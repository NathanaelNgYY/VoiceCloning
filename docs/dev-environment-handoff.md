# Dev Environment — Deployment Handoff

**Date:** 2026-07-07 · **Status:** ~85% deployed. Blocked on ONE admin permission (`iam:PassRole`) to launch the dev GPU instance. Everything else is live and verified.
**Guide:** `docs/dev-environment-duplication-guide.md` (full architecture + census). This file = what's done, what's left, exactly who does what.

---

## ✅ What is DONE and verified

| Resource | ID / value | Verified |
|---|---|---|
| AMI of staging (with all 14 unpushed commits on its disk) | `ami-06338e47a2f1bae6a` | **available** |
| Private subnet (Seoul 2a, 10.0.32.0/20) | `subnet-0c1937ef298f54500` | created |
| NAT Gateway (reuses previously-idle EIP 13.125.17.99) | `nat-0bcb9eb6ec860526f` | available |
| Private route table (0.0.0.0/0 → NAT) + S3 endpoint | `rtb-068aad306c3adcbe0` / `vpce-0386d983dfdff41dc` | associated |
| Dev GPU security group (3001-3003 from ALB SG only) | `sg-0c72f7cb18ede35d5` | created |
| Dev ALB + 3 target groups + 3 path rules (mirror staging) | `voice-gpu-alb-dev-359283066.ap-northeast-2.elb.amazonaws.com`, TGs `vcs-dev-tg-3001/3002/3003` | created (no target yet) |
| Dev Lambda (staging code, dev env vars) | `Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev` | invoked OK |
| Dev Function URL (AuthType NONE, matches staging) | `https://iayrdzq2eb4ot7pauprbgknd7y0uxlvd.lambda-url.ap-northeast-2.on.aws/` | 200 |
| Dev CloudFront — training | `EC2SYT1OKGW9Q` / **https://d1qh0ebsvevhy3.cloudfront.net** | serves app + `/api/models` 200 |
| Dev CloudFront — live-fast | `E3DE2SRSU9JAEG` / **https://dfzrfr93t2ruf.cloudfront.net** | serves app |
| Dev CloudFront — chatbot | `E3MLIO4CZFOPEO` / **https://d25sg72wp8oj5g.cloudfront.net** | serves app |
| S3 dev data | `s3://interns2026-small-projects-bucket-shared/echolect-dev/` mirrors `echolect/` (12 prefixes; 12GB legacy zip excluded) | listed |
| Shared bucket policy | 3 dev distro ARNs appended (additive) | re-read OK |
| Dev frontend bundles (training/live-fast/chatbot built with dev URLs; chatbot from `chatbot-live-full` worktree) | uploaded to `echolect-dev/dist-*` | 200 via CloudFront |
| Deploy scripts + env files | `scripts/deploy-{client,lambda,worker}.ps1`, `scripts/deploy.config.json`, `client/env/{dev,staging}/*.env` | dry-runs clean; commit `a93f403` |

Gotcha discovered en route (already fixed on dev): a new Function URL with AuthType NONE still 403s unless the function policy has **both** `FunctionURLAllowPublicAccess` **and** `FunctionURLAllowInvokeAction` (`lambda:InvokedViaFunctionUrl=true`) statements.

## 🔴 BLOCKED — needs an account admin (your role lacks these; the AWS console fails identically because it's the same role)

### 1. `iam:PassRole` to launch the dev GPU (the only thing blocking instance launch)

Ask the admin to add this to the `Liu_Teng_Yu_Intern2026` role's permissions policy:

```json
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "arn:aws:iam::329599637774:role/VoiClo_GPU",
  "Condition": { "StringEquals": { "iam:PassedToService": "ec2.amazonaws.com" } }
}
```

**OR** the admin launches the instance themselves — console UI path:
EC2 (Seoul) → Launch instance →
- Name `voice-gpu-dev`, tag `Environment=dev`
- AMI: My AMIs → `vcs-staging-2026-07-06` (`ami-06338e47a2f1bae6a`)
- Type `g6.xlarge`, key pair `VoiClo-Gpu-Seoul`
- Network: VPC `vpc-0b81d044238fcee4d`, subnet `subnet-0c1937ef298f54500` (vcs-dev-private), **Auto-assign public IP: Disable**, SG `vcs-dev-gpu-sg` (`sg-0c72f7cb18ede35d5`)
- Advanced → IAM instance profile: `VoiClo_GPU`
- Advanced → User data: paste the contents of the bootstrap script below

CLI equivalent (admin credentials):

```powershell
aws ec2 run-instances --region ap-northeast-2 --image-id ami-06338e47a2f1bae6a --instance-type g6.xlarge --subnet-id subnet-0c1937ef298f54500 --security-group-ids sg-0c72f7cb18ede35d5 --key-name VoiClo-Gpu-Seoul --iam-instance-profile Name=VoiClo_GPU --no-associate-public-ip-address --user-data file://dev-userdata.sh --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=voice-gpu-dev},{Key=Environment,Value=dev}]" --count 1
```

**Bootstrap script (`dev-userdata.sh`)** — repoints the clone at dev at first boot:

```bash
#!/bin/bash
exec > /var/log/dev-bootstrap.log 2>&1
set -x
DEVCORS="https://d1qh0ebsvevhy3.cloudfront.net,https://dfzrfr93t2ruf.cloudfront.net,https://d25sg72wp8oj5g.cloudfront.net"
for f in /home/ubuntu/VoiceCloning/gpu-worker/.env /home/ubuntu/VoiceCloning/gpu-inference-worker/.env; do
  sed -i 's|^S3_PREFIX=echolect/|S3_PREFIX=echolect-dev/|' "$f"
  sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=$DEVCORS|" "$f"
done
GW_ENV=/home/ubuntu/VoiceCloning/live-gateway/.env
UNIT=/etc/systemd/system/voice-live-gateway.service
grep -q '^PORT=' "$GW_ENV" || echo 'PORT=3002' >> "$GW_ENV"
grep -q '^NODE_ENV=' "$GW_ENV" || echo 'NODE_ENV=production' >> "$GW_ENV"
grep -q '^OPENAI_REALTIME_MODEL=' "$GW_ENV" || echo 'OPENAI_REALTIME_MODEL=gpt-realtime' >> "$GW_ENV"
grep -q '^OPENAI_REALTIME_VAD=' "$GW_ENV" || echo 'OPENAI_REALTIME_VAD=semantic_vad' >> "$GW_ENV"
if grep -q '^CORS_ORIGIN=' "$GW_ENV"; then sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=$DEVCORS|" "$GW_ENV"; else echo "CORS_ORIGIN=$DEVCORS" >> "$GW_ENV"; fi
sed -i '/^Environment=/d' "$UNIT"
grep -q '^EnvironmentFile=' "$UNIT" || sed -i "s|^\[Service\]|[Service]\nEnvironmentFile=$GW_ENV|" "$UNIT"
systemctl disable --now api-v2 2>/dev/null || true
sudo -u ubuntu pm2 delete live-gateway 2>/dev/null || true
sudo -u ubuntu pm2 save 2>/dev/null || true
systemctl daemon-reload
systemctl restart gpu-worker gpu-inference-worker voice-live-gateway
touch /home/ubuntu/DEV_BOOTSTRAP_DONE
```

### 2. The two auto-stop schedules (`events:*` / `scheduler:*` denied for your role)

Admin runs (after the instance exists — substitute `<DEV_INSTANCE_ID>`):

```powershell
# idle-stop every 5 min (mirrors staging rule VoiClo-gpu-idle-stop)
aws events put-rule --region ap-northeast-2 --name vcs-dev-gpu-idle-stop --schedule-expression "rate(5 minutes)"
aws lambda add-permission --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev --statement-id AllowEventBridgeGpuIdleStopDev --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:ap-northeast-2:329599637774:rule/vcs-dev-gpu-idle-stop
aws events put-targets --region ap-northeast-2 --rule vcs-dev-gpu-idle-stop --targets "Id=1,Arn=arn:aws:lambda:ap-northeast-2:329599637774:function:Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev,Input='{\"rawPath\":\"/api/instance/idle-check\",\"requestContext\":{\"http\":{\"method\":\"POST\"}}}'"
```

Console alternative: EventBridge → Rules → Create rule → Schedule `rate(5 minutes)` → target = Lambda `…-dev` → Configure input → Constant (JSON): `{"rawPath":"/api/instance/idle-check","requestContext":{"http":{"method":"POST"}}}`.

Nightly stop (21:00 KST backstop) per guide §9.2 — optional if the idle-stop exists.
**Until these exist: stop the dev GPU manually** (`aws ec2 stop-instances --region ap-northeast-2 --instance-ids <DEV_INSTANCE_ID>`).

### 3. (Optional, better isolation) scoped dev Lambda role

Dev Lambda currently reuses `Liu_Teng_Yu_Intern2026-LambdaExecutionRole` (staging's) because `iam:CreateRole` is denied. If the admin creates `vcs-lambda-dev` (trust `lambda.amazonaws.com`, policy in guide §6), swap with:
`aws lambda update-function-configuration --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-dev --role <new-role-arn>`

## ▶️ After the instance is launched (I/Claude do this, or you follow along)

1. `aws ec2 wait instance-running` then wait ~3–5 min for the bootstrap (`/home/ubuntu/DEV_BOOTSTRAP_DONE` marker; log: `/var/log/dev-bootstrap.log`).
2. Register in the ALB target groups (all 3):
   `aws elbv2 register-targets --region ap-northeast-2 --target-group-arn <each vcs-dev-tg-* arn> --targets Id=<DEV_INSTANCE_ID>` → `describe-target-health` until healthy.
3. Set the instance id in the dev Lambda env (`GPU_INSTANCE_ID=<DEV_INSTANCE_ID>`, keep every other var) and in `scripts/deploy.config.json` (`dev.instanceId`), commit.
4. Via SSM (`aws ssm start-session --target <DEV_INSTANCE_ID>`):
   - `cd ~/VoiceCloning && git push origin separate-containers-new` → publishes the 14 commits that so far exist only on the disk image.
5. Then locally: `git fetch`; `git checkout separate-containers-new && git pull`; `git checkout -b develop && git push -u origin develop`; `git checkout chatbot-live-full && git pull && git checkout -b develop-chatbot && git push -u origin develop-chatbot`.
6. Smoke test (§11 of the guide): voice list + TTS on https://d1qh0ebsvevhy3.cloudfront.net, live chat on https://dfzrfr93t2ruf.cloudfront.net, DeanVoice chat on https://d25sg72wp8oj5g.cloudfront.net, stop/start resilience, staging untouched.

## Notes / open items

- **Staging instance is still stopped** (it was stopped before we started; we never started it). Start it when users need it.
- Staging's public IP rotates every stop/start — `scripts/deploy-worker.ps1 -Env staging` now looks it up automatically.
- Dev worker deploys use SSM (`-Env dev`), no SSH needed.
- Security follow-ups (staging): Function URL is public (`NONE`); OpenAI key sits in `voice-live-gateway.service` unit file — rotate + move to EnvironmentFile during a quiet window (dev already fixed via bootstrap).
- AWS access recipe: paste identity-account keys → `aws sts assume-role --role-arn arn:aws:iam::329599637774:role/Liu_Teng_Yu_Intern2026 ...` (sessions ~1h; base keys ~2h).
