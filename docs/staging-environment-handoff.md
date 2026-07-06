# Staging Environment — Deployment Handoff (SELF-CONTAINED)

**Date:** 2026-07-07 · **Replaces** `docs/dev-environment-handoff.md` (deleted — its "dev" naming was backwards).
**Written for continuation on ANY device/session** — everything needed is in this file + the repo.

## ⚠️ Terminology (was flipped, now corrected everywhere)

- **STAGING = the NEW stack built 2026-07-06/07** (private-IP GPU, `-staging` names, `echolect-staging/`, branch `staging`). Stable copy for users.
- **DEV = the ORIGINAL system** (public-IP GPU `i-03f258d470a2fa73f`, `echolect/`, branch `separate-containers-new`, CloudFronts d3dghqhnk7aoku / doovx82fh9tfs / d2o0cbe2zunqkr). Where development happens.

## AWS access recipe (fresh machine)

1. Install AWS CLI v2 (`winget install Amazon.AWSCLI`).
2. From the AWS access portal, copy programmatic credentials for the **identity account 116310094355** and put them in `~/.aws/credentials` under `[default]`.
3. Hop into the project account (sessions last 1 h; base keys ~2 h — re-paste + re-assume as needed):
```powershell
aws sts assume-role --role-arn arn:aws:iam::329599637774:role/Liu_Teng_Yu_Intern2026 --role-session-name work --output json
# put the returned keys under a [project] profile, then use --profile project (or $env:AWS_PROFILE='project')
```
4. Known DENIED actions for this role (console fails identically — same role): `iam:*` (CreateRole, PassRole, reads), `events:*`, `scheduler:*`, `elasticloadbalancing:Delete*`, `ec2:ReplaceRoute`, `ec2:DeleteRoute`, `ec2:ReplaceRouteTableAssociation`, `ec2:ModifyVpcEndpoint`. Anything on that list = admin task.

## ✅ DONE (verified live)

| Resource | Value |
|---|---|
| AMI of the dev box (contains the 14 unpushed `separate-containers-new` commits on disk) | `ami-06338e47a2f1bae6a` (available) |
| Staging private subnet (Seoul 2a, 10.0.32.0/20) | `subnet-0c1937ef298f54500` |
| Staging NAT gateway (new EIP eipalloc-0e3b4e564f9b5acca) | `nat-0dadc68ca781b8df9` (available) |
| Route tables | old `rtb-068aad306c3adcbe0` (0.0.0.0/0 **blackhole** → deleted NAT; still associated to the subnet) · new `rtb-00bf8ce2b545ffc4e` (0.0.0.0/0 → new NAT, correct, **not yet associated** — see BLOCKED-0) |
| S3 Gateway endpoint | `vpce-0386d983dfdff41dc` (attached to old RTB; admin must also attach to the new one) |
| Staging GPU SG | `sg-03a2f3dddf4eff21c` (`vcs-staging-gpu-sg`, 3001-3003 from ALB SG `sg-0027def934fd4cb8d`) |
| Staging ALB | `voice-gpu-alb-staging-1031778835.ap-northeast-2.elb.amazonaws.com` (arn `…loadbalancer/app/voice-gpu-alb-staging/781c056e87784609`), listener rules mirror dev: `/api/live/chat/realtime`→3002, `/inference/progress/*`→3003, `/models*,/ref-audio*,/inference*`→3003, default→3001 |
| Staging TGs (HTTP, HC `/healthz`) | `vcs-staging-tg-3001/782635b79a09031d` · `-3002/77d07064082cbead` · `-3003/3449adfcba215f65` (no target registered yet) |
| Staging Lambda | `Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging` (nodejs24.x, 128 MB, 120 s, staging exec role reused — see BLOCKED-3). Env = dev's map with `S3_PREFIX=echolect-staging/`, `GPU_IDLE_STOP_MINUTES=90`, worker URLs → staging ALB, CORS → the 3 staging domains, `GPU_INSTANCE_ID=placeholder-until-launch` |
| Staging Function URL | `https://7xx6w7q5jwzda6nlltlyfckfzm0vyfmy.lambda-url.ap-northeast-2.on.aws/` — AuthType NONE **with BOTH policy statements** (`FunctionURLAllowPublicAccess` + `FunctionURLAllowInvokeAction`; a new URL 403s without the second one) |
| Staging CloudFronts (origins updated to staging Lambda/ALB/S3 paths 2026-07-07) | training `EC2SYT1OKGW9Q` → **https://d1qh0ebsvevhy3.cloudfront.net** · live-fast `E3DE2SRSU9JAEG` → **https://dfzrfr93t2ruf.cloudfront.net** · chatbot `E3MLIO4CZFOPEO` → **https://d25sg72wp8oj5g.cloudfront.net** |
| S3 staging data | `s3://interns2026-small-projects-bucket-shared/echolect-staging/` (mirrors `echolect/`, seeded 07-06; `echolect-dev/` deleted; frontend bundles for the 3 staging domains already in `dist-*`) |
| Shared bucket policy | includes the 3 staging distro ARNs |
| Branches | `staging` (from separate-containers-new) + `staging-chatbot` (from chatbot-live-full), pushed. NOTE: fast-forward `staging` after the box pushes its 14 commits (POST-LAUNCH step 4) |
| Deploy tooling | `scripts/deploy-{client,lambda,worker}.ps1` + `scripts/deploy.config.json` (staging=SSM/new stack, dev=SSH/original), `client/env/{staging,dev}/*.env` |
| Config snapshots / bootstrap | `docs/aws-snapshots/cf-*-staging.json` (the 3 ORIGINAL distro configs), `docs/aws-snapshots/staging-userdata.sh` (first-boot script for the staging instance) |

Verify-any-time smoke: `https://d1qh0ebsvevhy3.cloudfront.net/api/models` → 200 JSON (works today; GPU-dependent features need the instance).

## 🔴 BLOCKED — admin tasks (in order; console or admin CLI)

**0. Fix the private subnet's route (1 command).** The original NAT was deleted overnight (unknown actor — ask if NATs are allowed/whitelist `nat-0dadc68ca781b8df9`!); a replacement NAT exists but the role can't edit routes:
```powershell
aws ec2 replace-route --region ap-northeast-2 --route-table-id rtb-068aad306c3adcbe0 --destination-cidr-block 0.0.0.0/0 --nat-gateway-id nat-0dadc68ca781b8df9
```
(Console: VPC → Route tables → rtb-068aad306c3adcbe0 → Routes → Edit → point 0.0.0.0/0 at nat-0dadc68ca781b8df9.) Alternatively associate `rtb-00bf8ce2b545ffc4e` to subnet-0c1937ef298f54500 and add vpce-0386d983dfdff41dc to it.

**1. `iam:PassRole` so the staging GPU can be launched.** Add to the `Liu_Teng_Yu_Intern2026` role policy:
```json
{ "Effect": "Allow", "Action": "iam:PassRole", "Resource": "arn:aws:iam::329599637774:role/VoiClo_GPU", "Condition": { "StringEquals": { "iam:PassedToService": "ec2.amazonaws.com" } } }
```
**OR** the admin launches it directly — console: EC2 (Seoul) → Launch instance → name `voice-gpu-staging`, AMI `vcs-staging-2026-07-06` (ami-06338e47a2f1bae6a), g6.xlarge, key `VoiClo-Gpu-Seoul`, VPC `vpc-0b81d044238fcee4d`, subnet `subnet-0c1937ef298f54500`, public IP **Disable**, SG `vcs-staging-gpu-sg`, IAM profile `VoiClo_GPU`, user-data = contents of `docs/aws-snapshots/staging-userdata.sh`, tag `Environment=staging`. CLI:
```powershell
aws ec2 run-instances --region ap-northeast-2 --image-id ami-06338e47a2f1bae6a --instance-type g6.xlarge --subnet-id subnet-0c1937ef298f54500 --security-group-ids sg-03a2f3dddf4eff21c --key-name VoiClo-Gpu-Seoul --iam-instance-profile Name=VoiClo_GPU --no-associate-public-ip-address --user-data file://docs/aws-snapshots/staging-userdata.sh --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=voice-gpu-staging},{Key=Environment,Value=staging}]" --count 1
```

**2. Idle-stop schedule** (after launch, substitute `<STAGING_INSTANCE_ID>` — actually the rule needs no ID; it invokes the staging Lambda which reads `GPU_INSTANCE_ID` from env):
```powershell
aws events put-rule --region ap-northeast-2 --name vcs-staging-gpu-idle-stop --schedule-expression "rate(5 minutes)"
aws lambda add-permission --region ap-northeast-2 --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging --statement-id AllowEventBridgeGpuIdleStop --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:ap-northeast-2:329599637774:rule/vcs-staging-gpu-idle-stop
aws events put-targets --region ap-northeast-2 --rule vcs-staging-gpu-idle-stop --targets "Id=1,Arn=arn:aws:lambda:ap-northeast-2:329599637774:function:Liu_Teng_Yu_Intern2026-Voice_Cloning_Project-staging,Input='{\"rawPath\":\"/api/instance/idle-check\",\"requestContext\":{\"http\":{\"method\":\"POST\"}}}'"
```
Console: EventBridge → Rules → Create → schedule rate(5 minutes) → target Lambda `…-staging` → constant JSON input above. **Until this exists, stop the staging GPU manually.**

**3. Cleanup + optional:** delete leftover `voice-gpu-alb-dev` (arn `…/app/voice-gpu-alb-dev/17b83508f5602cd7`, ~$20/mo) + TGs `vcs-dev-tg-3001/3002/3003` (role can't delete ELB resources). Optionally create a scoped `vcs-lambda-staging` exec role (S3 `echolect-staging/*`, EC2 start/stop on `Environment=staging`, logs) and swap it onto the staging Lambda.

## ▶️ POST-LAUNCH checklist (Claude or manual; needs only the normal role)

1. Wait running + ~5 min for bootstrap (`/home/ubuntu/STAGING_BOOTSTRAP_DONE`; log `/var/log/staging-bootstrap.log`).
2. Register in all 3 TGs and wait healthy:
```powershell
aws elbv2 register-targets --region ap-northeast-2 --target-group-arn <each vcs-staging-tg arn from the table> --targets Id=<STAGING_INSTANCE_ID>
aws elbv2 describe-target-health --region ap-northeast-2 --target-group-arn <each>
```
3. Set `GPU_INSTANCE_ID=<STAGING_INSTANCE_ID>` in the staging Lambda env (fetch the full var map with get-function-configuration, change ONLY that key, update-function-configuration) and in `scripts/deploy.config.json` → `staging.instanceId`; commit.
4. Via SSM (`aws ssm start-session --region ap-northeast-2 --target <STAGING_INSTANCE_ID>`): `cd ~/VoiceCloning && git push origin separate-containers-new` (publishes the 14 commits that exist only on the image), then locally fast-forward: `git checkout staging && git merge origin/separate-containers-new && git push`.
5. Smoke test (§11 of `docs/dev-environment-duplication-guide.md`): voice list + TTS at d1qh0ebsvevhy3, live chat at dfzrfr93t2ruf, DeanVoice chat at d25sg72wp8oj5g; stop/start resilience; confirm the ORIGINAL three domains still work (dev untouched).

## Notes

- The original (dev) GPU `i-03f258d470a2fa73f` is currently **stopped**; its public IP rotates each start (deploy script looks it up).
- Staging CloudFront/API works TODAY for non-GPU features (S3-backed voice list etc.) — only GPU flows await the instance.
- Deploy flows: `scripts/deploy-client.ps1 -Env staging|dev -Mode training|live-fast|chatbot`, `deploy-lambda.ps1`, `deploy-worker.ps1`. Chatbot builds must run from `staging-chatbot`/`chatbot-live-full` checkout (script enforces).
- Security follow-ups: both Function URLs are public (`NONE`) — harden both to AWS_IAM+OAC later; rotate the OpenAI key (it sat in the dev box's unit file; staging bootstrap moves it to an EnvironmentFile).
- Architecture reference: `docs/dev-environment-duplication-guide.md` (note: written with the old flipped naming — its "dev" = today's "staging").
