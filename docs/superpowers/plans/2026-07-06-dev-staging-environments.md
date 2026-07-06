# Dev + Staging Environments Implementation Plan

> **Superseded/extended by `docs/dev-environment-duplication-guide.md`** (adds the 3rd chatbot
> frontend, private-IP + NAT networking, idle-stop EventBridge duplication, and on-host
> v2ProPlus specifics).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a fully separate dev environment (new GPU EC2 + `-dev` Lambda, ALB, CloudFront ×2, S3 prefix) so programmers work on dev while users keep using the existing stack, relabeled staging.

**Architecture:** Staging = the existing live stack, untouched. Dev = a parallel copy of every tier: a g6.xlarge launched from an AMI of the staging instance, a dev Lambda Function URL, a dev ALB, two dev CloudFront distributions (training + live-fast/chatbot frontends), and the shared S3 bucket under a new `echolect-dev/` prefix. Code flows `feature → develop → dev env → main → staging` via per-component PowerShell deploy scripts with an `-Env` flag.

**Tech Stack:** AWS CLI v2 (EC2, ELBv2, Lambda, CloudFront, IAM, EventBridge Scheduler, S3), PowerShell 5.1 scripts, Vite env files, systemd on the EC2 hosts.

**Spec:** `docs/superpowers/specs/2026-07-06-dev-staging-environments-design.md` (amended: dev storage = same shared bucket with `echolect-dev/` prefix, not a new bucket — decided with user 2026-07-06 because the bucket is the org-shared interns bucket).

## Global Constraints

- Compute region: `ap-northeast-2` (EC2, ALB, Lambda, EventBridge). S3 region: `ap-southeast-1`.
- Shared data bucket: `interns2026-small-projects-bucket-shared`; staging prefix `echolect/`, dev prefix `echolect-dev/`.
- Staging resources are NEVER modified (read-only discovery + tagging only). Staging EC2: `i-03f258d470a2fa73f`. Staging training distro: `E2KTGN0G56FW71` (`d3dghqhnk7aoku.cloudfront.net`); staging live-fast distro domain: `doovx82fh9tfs.cloudfront.net`.
- Every new AWS resource: name suffixed `-dev`, tagged `Environment=dev`.
- Branches: `develop` → dev environment, `main` → staging.
- All repo files: ES modules where JS; PowerShell scripts must run on PowerShell 5.1 (no `&&`, no ternary).
- Discovered values (subnet IDs, Lambda name, client-hosting origins, ALB rules) are recorded in `docs/environments.md` by Task 2 and referenced by later tasks as `<angle-bracket>` values read from that file — every later task says exactly which row to read.

---

### Task 1: `develop` branch + environments doc skeleton

**Files:**
- Create: `docs/environments.md`

**Interfaces:**
- Produces: the `develop` branch (all later repo commits in this plan land on `develop`); `docs/environments.md` with a two-column matrix later tasks fill in.

- [ ] **Step 1: Create `develop` from `main` and push**

```powershell
git checkout main; git pull; git checkout -b develop; git push -u origin develop
```

Expected: `develop` tracking `origin/develop`.

- [ ] **Step 2: Write the matrix skeleton**

Create `docs/environments.md`:

```markdown
# Environments: dev & staging

Staging = the original live stack (users). Dev = the parallel stack (programmers).
`main` deploys to staging; `develop` deploys to dev. Deploy scripts: `scripts/deploy-*.ps1 -Env dev|staging`.

## Resource matrix

| Value | Staging | Dev |
|---|---|---|
| GPU EC2 instance ID | i-03f258d470a2fa73f | (Task 4) |
| EC2 subnet / SG / key pair / instance profile | (Task 2) | same as staging |
| AMI used | — | (Task 3) |
| ALB name / DNS | voice-gpu-alb / voice-gpu-alb-815777974.ap-northeast-2.elb.amazonaws.com | (Task 5) |
| ALB listener rules (path → port) | (Task 2) | mirrored |
| Lambda function name | (Task 2) | (Task 6) |
| Lambda runtime/handler/memory/timeout | (Task 2) | same |
| Lambda role | (Task 2) | vcs-lambda-dev (Task 6) |
| Lambda Function URL | fxeoewfr5wdic5dfxtrlsylonq0bvkdy.lambda-url.ap-northeast-2.on.aws | (Task 6) |
| Data S3 | s3://interns2026-small-projects-bucket-shared/echolect/ | s3://interns2026-small-projects-bucket-shared/echolect-dev/ |
| Client hosting origin (training) | (Task 2) | (Task 7) |
| Client hosting origin (live-fast/chatbot) | (Task 2) | (Task 7) |
| CloudFront distro (training) | E2KTGN0G56FW71 / d3dghqhnk7aoku.cloudfront.net | (Task 7) |
| CloudFront distro (live-fast/chatbot) | (Task 2) / doovx82fh9tfs.cloudfront.net | (Task 7) |
| CloudFront OAC IDs (S3, Lambda URL) | (Task 2) | reused |
| Nightly auto-stop | — | (Task 9) |

## Runbooks

(Task 12 fills this in: start/stop dev GPU, deploy each component, promote develop → main.)
```

- [ ] **Step 3: Commit**

```powershell
git add docs/environments.md; git commit -m "docs: environments matrix skeleton for dev/staging split"
```

---

### Task 2: Discovery — record every staging resource detail

Read-only. Fills the `(Task 2)` cells in `docs/environments.md`.

**Files:**
- Modify: `docs/environments.md`

**Interfaces:**
- Produces: filled matrix rows that Tasks 3–9 read: `<staging-lambda-name>`, `<staging-lambda-runtime>`, `<staging-lambda-role>`, `<subnet-id>`, `<sg-ids>`, `<key-name>`, `<instance-profile>`, `<alb-listener-rules>`, `<training-client-origin>`, `<livefast-client-origin>`, `<livefast-distro-id>`, `<oac-s3-id>`, `<oac-lambda-id>`.

- [ ] **Step 1: EC2 details**

```powershell
aws ec2 describe-instances --region ap-northeast-2 --instance-ids i-03f258d470a2fa73f --query "Reservations[0].Instances[0].{Type:InstanceType,Subnet:SubnetId,SGs:SecurityGroups,Key:KeyName,Profile:IamInstanceProfile.Arn,Volumes:BlockDeviceMappings}"
```

Record Subnet, SG IDs, KeyName, instance profile ARN in the matrix.

- [ ] **Step 2: ALB listeners and target groups**

```powershell
aws elbv2 describe-load-balancers --region ap-northeast-2 --names voice-gpu-alb --query "LoadBalancers[0].{Arn:LoadBalancerArn,Subnets:AvailabilityZones[].SubnetId,SGs:SecurityGroups}"
aws elbv2 describe-listeners --region ap-northeast-2 --load-balancer-arn <alb-arn> --query "Listeners[].{Arn:ListenerArn,Port:Port,Protocol:Protocol}"
aws elbv2 describe-rules --region ap-northeast-2 --listener-arn <listener-arn>
aws elbv2 describe-target-groups --region ap-northeast-2 --load-balancer-arn <alb-arn> --query "TargetGroups[].{Name:TargetGroupName,Port:Port,Proto:Protocol,Health:HealthCheckPath}"
```

Record every listener rule (path pattern → target group → port; expect ports 3001 training worker, 3002 live gateway, 3003 inference worker) and each target group's health-check path.

- [ ] **Step 3: Lambda details**

```powershell
aws lambda list-functions --region ap-northeast-2 --query "Functions[?contains(FunctionName,'voice') || contains(FunctionName,'clon')].FunctionName"
aws lambda get-function-configuration --region ap-northeast-2 --function-name <staging-lambda-name> --query "{Runtime:Runtime,Handler:Handler,Mem:MemorySize,Timeout:Timeout,Role:Role,Env:Environment.Variables}"
aws lambda get-function-url-config --region ap-northeast-2 --function-name <staging-lambda-name>
```

Record name, runtime, handler, memory, timeout, role ARN, AuthType (expect `AWS_IAM`). If the name filter finds nothing, list all functions unfiltered and identify by the known Function URL host.

- [ ] **Step 4: Both CloudFront distributions**

```powershell
aws cloudfront list-distributions --query "DistributionList.Items[?DomainName=='doovx82fh9tfs.cloudfront.net'].Id"
aws cloudfront get-distribution-config --id E2KTGN0G56FW71 > "$env:TEMP\cf-training-staging.json"
aws cloudfront get-distribution-config --id <livefast-distro-id> > "$env:TEMP\cf-livefast-staging.json"
aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[].{Id:Id,Name:Name,OriginType:OriginAccessControlOriginType}"
```

From each saved config record: every origin (domain + origin path — this reveals whether the clients are hosted in dedicated buckets or under prefixes of the shared bucket), the behavior order (`/api/*` → Lambda URL origin, SSE/WSS paths → ALB origin, default → client origin), and the OAC IDs used for the S3 and Lambda-URL origins.

- [ ] **Step 5: Tag staging resources**

```powershell
aws ec2 create-tags --region ap-northeast-2 --resources i-03f258d470a2fa73f --tags Key=Environment,Value=staging
aws lambda tag-resource --region ap-northeast-2 --resource <staging-lambda-arn> --tags Environment=staging
aws elbv2 add-tags --region ap-northeast-2 --resource-arns <alb-arn> --tags Key=Environment,Value=staging
```

- [ ] **Step 6: Fill the matrix and commit**

Update every `(Task 2)` cell in `docs/environments.md` with real values, then:

```powershell
git add docs/environments.md; git commit -m "docs: record staging infrastructure details in environments matrix"
```

---

### Task 3: AMI snapshot of the staging instance

**Interfaces:**
- Consumes: nothing (staging instance ID is a global constant).
- Produces: `<ami-id>` recorded in the matrix, used by Task 4.

- [ ] **Step 1: Confirm the pipeline is idle**

Check the staging app (training tab) shows no running job, or:

```powershell
Invoke-RestMethod https://d3dghqhnk7aoku.cloudfront.net/api/training/status
```

Expected: no active job (worker state is in-memory, so an idle snapshot is clean).

- [ ] **Step 2: Create the AMI without rebooting staging**

```powershell
aws ec2 create-image --region ap-northeast-2 --instance-id i-03f258d470a2fa73f --name "vcs-staging-2026-07-06" --description "Voice Cloning Studio staging clone for dev env" --no-reboot --tag-specifications "ResourceType=image,Tags=[{Key=Environment,Value=dev}]"
```

`--no-reboot` avoids user-facing downtime; acceptable because the pipeline is idle and app state is in S3/memory, not mid-write on disk.

- [ ] **Step 3: Wait until available**

```powershell
aws ec2 wait image-available --region ap-northeast-2 --image-ids <ami-id>
```

Expected: returns cleanly (can take 10–20 min for a large volume). Record `<ami-id>` in the matrix and commit the doc update:

```powershell
git add docs/environments.md; git commit -m "docs: record staging AMI id"
```

---

### Task 4: Launch + configure the dev GPU EC2

**Interfaces:**
- Consumes: `<ami-id>` (Task 3), `<subnet-id>`, `<sg-ids>`, `<key-name>`, `<instance-profile>` (Task 2 matrix).
- Produces: `<dev-instance-id>`, `<dev-private-ip>` in the matrix; a running dev host whose workers point at `echolect-dev/`.

- [ ] **Step 1: Launch**

```powershell
aws ec2 run-instances --region ap-northeast-2 --image-id <ami-id> --instance-type g6.xlarge --subnet-id <subnet-id> --security-group-ids <sg-ids> --key-name <key-name> --iam-instance-profile Arn=<instance-profile> --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=voice-gpu-dev},{Key=Environment,Value=dev}]" --count 1
aws ec2 wait instance-running --region ap-northeast-2 --instance-ids <dev-instance-id>
```

Record `<dev-instance-id>` and private IP in the matrix.

- [ ] **Step 2: Point the on-host env files at the dev prefix**

SSH in (same key as staging). The AMI carries staging values; change only the prefix for now (CORS gets dev domains in Task 8):

```bash
ssh -i <key.pem> ubuntu@<dev-public-or-private-ip>
sudo sed -i 's|^S3_PREFIX=echolect/|S3_PREFIX=echolect-dev/|' /path/to/gpu-worker/.env /path/to/gpu-inference-worker/.env
```

The exact on-host env file paths come from the systemd units: `systemctl cat gpu-inference-worker | grep EnvironmentFile` (and the equivalent for the training worker and live gateway) — use whatever paths those print.

- [ ] **Step 3: Restart services and verify health**

```bash
sudo systemctl restart <training-worker-unit> <inference-worker-unit> <live-gateway-unit>
curl -s localhost:3001/healthz; curl -s localhost:3003/healthz; curl -s localhost:3002/healthz
curl -s localhost:3001/readyz; curl -s localhost:3003/readyz
```

Expected: all `/healthz` 200; `/readyz` 200 (503 means an env/config error — read the body, fix the env file, restart).

- [ ] **Step 4: Update matrix + commit**

```powershell
git add docs/environments.md; git commit -m "docs: record dev GPU instance details"
```

---

### Task 5: Dev ALB mirroring staging's routing

**Interfaces:**
- Consumes: Task 2's ALB rows (subnets, SGs, listener rules, target-group ports + health checks); `<dev-instance-id>` (Task 4).
- Produces: `<dev-alb-dns>` in the matrix (CloudFront origin for Task 7; `GPU_WORKER_URL` for Task 6).

- [ ] **Step 1: Create target groups (one per staging target group)**

For each staging target group recorded in Task 2 (expect ports 3001/3002/3003):

```powershell
aws elbv2 create-target-group --region ap-northeast-2 --name vcs-dev-tg-<port> --protocol HTTP --port <port> --vpc-id <vpc-id> --health-check-path <health-path-from-matrix> --target-type instance --tags Key=Environment,Value=dev
aws elbv2 register-targets --region ap-northeast-2 --target-group-arn <new-tg-arn> --targets Id=<dev-instance-id>
```

- [ ] **Step 2: Create the ALB + listener + rules**

```powershell
aws elbv2 create-load-balancer --region ap-northeast-2 --name voice-gpu-alb-dev --subnets <alb-subnets> --security-groups <alb-sgs> --tags Key=Environment,Value=dev
aws elbv2 create-listener --region ap-northeast-2 --load-balancer-arn <dev-alb-arn> --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=<default-tg-arn>
```

Then recreate each non-default staging rule verbatim (same priority order, same path patterns), pointing at the matching dev target group:

```powershell
aws elbv2 create-rule --region ap-northeast-2 --listener-arn <dev-listener-arn> --priority <n> --conditions Field=path-pattern,Values=<path-pattern> --actions Type=forward,TargetGroupArn=<dev-tg-arn>
```

- [ ] **Step 3: Verify targets healthy**

```powershell
aws elbv2 describe-target-health --region ap-northeast-2 --target-group-arn <each-dev-tg-arn>
```

Expected: `State: healthy` for the dev instance in every group. Then confirm end-to-end:

```powershell
Invoke-RestMethod http://<dev-alb-dns>/healthz
```

- [ ] **Step 4: Update matrix + commit**

```powershell
git add docs/environments.md; git commit -m "docs: record dev ALB details"
```

---

### Task 6: Dev IAM role + dev Lambda + Function URL

**Interfaces:**
- Consumes: staging Lambda config rows (Task 2), `<dev-instance-id>` (Task 4), `<dev-alb-dns>` (Task 5).
- Produces: `<dev-lambda-name>` = `<staging-lambda-name>-dev`, `<dev-function-url-domain>` in the matrix (origin for Task 7).

- [ ] **Step 1: Create the scoped role**

Trust policy (`$env:TEMP\lambda-trust.json`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Principal": { "Service": "lambda.amazonaws.com" }, "Action": "sts:AssumeRole" }]
}
```

Permissions policy (`$env:TEMP\lambda-dev-policy.json`) — S3 scoped to the dev prefix, EC2 scoped to the dev instance:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::interns2026-small-projects-bucket-shared/echolect-dev/*" },
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::interns2026-small-projects-bucket-shared", "Condition": { "StringLike": { "s3:prefix": "echolect-dev/*" } } },
    { "Effect": "Allow", "Action": ["ec2:StartInstances", "ec2:StopInstances"], "Resource": "arn:aws:ec2:ap-northeast-2:*:instance/<dev-instance-id>" },
    { "Effect": "Allow", "Action": "ec2:DescribeInstances", "Resource": "*" },
    { "Effect": "Allow", "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], "Resource": "*" }
  ]
}
```

```powershell
aws iam create-role --role-name vcs-lambda-dev --assume-role-policy-document file://$env:TEMP/lambda-trust.json --tags Key=Environment,Value=dev
aws iam put-role-policy --role-name vcs-lambda-dev --policy-name vcs-lambda-dev-scope --policy-document file://$env:TEMP/lambda-dev-policy.json
```

Before finalizing, diff against the staging role's policies (`aws iam list-attached-role-policies` / `list-role-policies` on `<staging-lambda-role>`) — if staging's role has extra permissions the router needs (e.g. SES for email notify), copy those statements too, scoped to dev resources where applicable.

- [ ] **Step 2: Package and create the function**

```powershell
cd lambda; npm run package:function-url
aws lambda create-function --region ap-northeast-2 --function-name <staging-lambda-name>-dev --runtime <staging-runtime> --handler <staging-handler> --memory-size <staging-mem> --timeout <staging-timeout> --role arn:aws:iam::<account>:role/vcs-lambda-dev --zip-file fileb://.dist/voice-cloning-function-url.zip --tags Environment=dev
```

- [ ] **Step 3: Set dev env vars**

Same keys as staging (Task 2 captured them; the local reference is `lambda/.env.deployment`), with these values changed — `CORS_ORIGIN` and `GPU_WORKER_PUBLIC_URL` get temporary staging values until Task 8:

```powershell
aws lambda update-function-configuration --region ap-northeast-2 --function-name <staging-lambda-name>-dev --environment "Variables={ARTIFACT_SOURCE=s3,MODEL_SOURCE=s3,S3_BUCKET=interns2026-small-projects-bucket-shared,S3_REGION=ap-southeast-1,S3_PREFIX=echolect-dev/,GPU_INSTANCE_ID=<dev-instance-id>,GPU_INSTANCE_REGION=ap-northeast-2,GPU_IDLE_STOP_MINUTES=30,GPU_WORKER_URL=http://<dev-alb-dns>,GPU_WORKER_PUBLIC_URL=https://placeholder-until-task8,CORS_ORIGIN=https://placeholder-until-task8}"
```

Note `GPU_IDLE_STOP_MINUTES=30` — the router's idle-stop is the primary dev cost control; Task 9's nightly stop is the backstop.

- [ ] **Step 4: Create the Function URL (AWS_IAM, matching staging)**

```powershell
aws lambda create-function-url-config --region ap-northeast-2 --function-name <staging-lambda-name>-dev --auth-type AWS_IAM
```

Record the returned URL domain as `<dev-function-url-domain>`.

- [ ] **Step 5: Smoke-check + commit matrix**

The URL is IAM-protected, so an unsigned request returning `403 Forbidden` (not a timeout/5xx) proves the function + URL exist:

```powershell
Invoke-WebRequest https://<dev-function-url-domain>/api/models -UseBasicParsing
```

Expected: 403. Then:

```powershell
git add docs/environments.md; git commit -m "docs: record dev lambda details"
```

---

### Task 7: Dev client hosting + two dev CloudFront distributions

**Interfaces:**
- Consumes: saved staging distro configs (Task 2 JSON files), `<dev-function-url-domain>` (Task 6), `<dev-alb-dns>` (Task 5), OAC IDs (Task 2), client-hosting origins (Task 2).
- Produces: `<dev-training-domain>`, `<dev-livefast-domain>`, `<dev-training-distro-id>`, `<dev-livefast-distro-id>`, dev client-hosting origins — all in the matrix.

- [ ] **Step 1: Create the dev client hosting origins**

Task 2 revealed where `dist-training` / `dist-chatbot` are served from. Mirror whichever form staging uses:

- If dedicated client buckets: create `<staging-client-bucket>-dev` in the same region as the staging client bucket, block public access on, and after Step 2 attach the same OAC-style bucket policy with the dev distro ARN.
- If prefixes of the shared bucket: dev clients live under sibling prefixes (e.g. `echolect-dev/client-training/`), no new bucket.

Record the chosen origins in the matrix.

- [ ] **Step 2: Clone each distribution config**

For each of the two saved configs (`cf-training-staging.json`, `cf-livefast-staging.json`), produce a dev copy with exactly these changes, then create:

1. Drop the `ETag` wrapper; keep only the inner `DistributionConfig`.
2. `CallerReference` → new GUID (`[guid]::NewGuid().ToString()`).
3. `Comment` → `"vcs <training|livefast> dev"`.
4. `Aliases` → `{ "Quantity": 0 }` (dev uses the default `*.cloudfront.net` domain).
5. Each origin's `DomainName`: Lambda-URL origin → `<dev-function-url-domain>`; ALB origin → `<dev-alb-dns>`; client origin → the dev origin from Step 1 (adjust `OriginPath` if prefix-based). Keep the same `OriginAccessControlId`s (OACs are reusable across distributions).
6. Everything else (behavior order, cache/origin-request policies, error pages) stays byte-identical.

```powershell
aws cloudfront create-distribution --distribution-config file://$env:TEMP/cf-training-dev.json
aws cloudfront create-distribution --distribution-config file://$env:TEMP/cf-livefast-dev.json
```

Record IDs + domains; tag both:

```powershell
aws cloudfront tag-resource --resource arn:aws:cloudfront::<account>:distribution/<dev-distro-id> --tags "Items=[{Key=Environment,Value=dev}]"
```

- [ ] **Step 3: Grant the dev distros invoke on the dev Function URL**

```powershell
aws lambda add-permission --region ap-northeast-2 --function-name <staging-lambda-name>-dev --statement-id cf-training-dev --action lambda:InvokeFunctionUrl --principal cloudfront.amazonaws.com --source-arn arn:aws:cloudfront::<account>:distribution/<dev-training-distro-id>
aws lambda add-permission --region ap-northeast-2 --function-name <staging-lambda-name>-dev --statement-id cf-livefast-dev --action lambda:InvokeFunctionUrl --principal cloudfront.amazonaws.com --source-arn arn:aws:cloudfront::<account>:distribution/<dev-livefast-distro-id>
```

And if Step 1 created dev client buckets, attach the S3 bucket policy allowing `cloudfront.amazonaws.com` with the matching dev distro `AWS:SourceArn` (copy staging's client-bucket policy, swap bucket + distro ARNs).

- [ ] **Step 4: Wait deployed + commit matrix**

```powershell
aws cloudfront wait distribution-deployed --id <dev-training-distro-id>
aws cloudfront wait distribution-deployed --id <dev-livefast-distro-id>
git add docs/environments.md; git commit -m "docs: record dev CloudFront distributions"
```

---

### Task 8: Wire real dev domains into CORS + seed dev data

**Interfaces:**
- Consumes: `<dev-training-domain>`, `<dev-livefast-domain>` (Task 7); `<dev-lambda-name>` (Task 6); dev host env paths (Task 4).
- Produces: a dev backend that accepts requests from the dev frontends; `echolect-dev/` populated.

- [ ] **Step 1: Fix the dev Lambda's placeholder env vars**

Re-run the Task 6 Step 3 `update-function-configuration` command with all the same values except:

```
CORS_ORIGIN=https://<dev-training-domain>,https://<dev-livefast-domain>
GPU_WORKER_PUBLIC_URL=https://<dev-livefast-domain>
```

- [ ] **Step 2: Fix CORS on the dev host**

SSH to the dev instance and in each env file found in Task 4 Step 2 replace the staging CORS line:

```bash
sudo sed -i 's|^CORS_ORIGIN=.*|CORS_ORIGIN=https://<dev-training-domain>,https://<dev-livefast-domain>|' <each-env-file>
sudo systemctl restart <training-worker-unit> <inference-worker-unit> <live-gateway-unit>
```

- [ ] **Step 3: Seed dev data from staging (one-time)**

```powershell
aws s3 sync s3://interns2026-small-projects-bucket-shared/echolect/ s3://interns2026-small-projects-bucket-shared/echolect-dev/ --region ap-southeast-1
```

Expected: trained voice models, reference audio, configs copied. Spot-check:

```powershell
aws s3 ls s3://interns2026-small-projects-bucket-shared/echolect-dev/ --region ap-southeast-1
```

- [ ] **Step 4: Commit matrix updates**

```powershell
git add docs/environments.md; git commit -m "docs: dev CORS wired, dev data seeded"
```

---

### Task 9: Nightly auto-stop for the dev GPU

**Interfaces:**
- Consumes: `<dev-instance-id>` (Task 4).
- Produces: EventBridge schedule `vcs-dev-gpu-nightly-stop` recorded in the matrix.

- [ ] **Step 1: Scheduler role**

Trust policy (`$env:TEMP\scheduler-trust.json`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Principal": { "Service": "scheduler.amazonaws.com" }, "Action": "sts:AssumeRole" }]
}
```

Policy (`$env:TEMP\scheduler-policy.json`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Action": "ec2:StopInstances", "Resource": "arn:aws:ec2:ap-northeast-2:*:instance/<dev-instance-id>" }]
}
```

```powershell
aws iam create-role --role-name vcs-dev-scheduler --assume-role-policy-document file://$env:TEMP/scheduler-trust.json --tags Key=Environment,Value=dev
aws iam put-role-policy --role-name vcs-dev-scheduler --policy-name stop-dev-gpu --policy-document file://$env:TEMP/scheduler-policy.json
```

- [ ] **Step 2: Nightly stop schedule (21:00 KST = 12:00 UTC)**

```powershell
aws scheduler create-schedule --region ap-northeast-2 --name vcs-dev-gpu-nightly-stop --schedule-expression "cron(0 12 * * ? *)" --flexible-time-window "Mode=OFF" --target "Arn=arn:aws:scheduler:::aws-sdk:ec2:stopInstances,RoleArn=arn:aws:iam::<account>:role/vcs-dev-scheduler,Input='{\"InstanceIds\":[\"<dev-instance-id>\"]}'"
```

- [ ] **Step 3: Verify it fires (one-shot test)**

Temporarily set the cron to 3 minutes from now (`aws scheduler update-schedule … --schedule-expression "cron(<mm> <hh> * * ? *)"`), confirm the instance stops, then restore the nightly expression and start the instance again:

```powershell
aws ec2 start-instances --region ap-northeast-2 --instance-ids <dev-instance-id>
```

- [ ] **Step 4: Commit matrix update**

```powershell
git add docs/environments.md; git commit -m "docs: record dev nightly auto-stop schedule"
```

---

### Task 10: Deploy scripts + per-env client env files

**Files:**
- Create: `scripts/deploy.config.json`, `scripts/deploy-client.ps1`, `scripts/deploy-lambda.ps1`, `scripts/deploy-worker.ps1`
- Create: `client/env/dev/training.env`, `client/env/dev/live-fast.env`, `client/env/dev/chatbot.env`, `client/env/staging/training.env`, `client/env/staging/live-fast.env`, `client/env/staging/chatbot.env`

**Interfaces:**
- Consumes: every dev/staging value from the completed matrix.
- Produces: `scripts/deploy-client.ps1 -Env dev|staging -Mode training|live-fast|chatbot`, `scripts/deploy-lambda.ps1 -Env dev|staging`, `scripts/deploy-worker.ps1 -Env dev|staging` — the commands Task 11 and the runbook use.

- [ ] **Step 1: Shared config file**

`scripts/deploy.config.json` — every per-env value in one place (fill from the matrix; `clientTarget` entries use whatever origin form Task 7 Step 1 produced):

```json
{
  "dev": {
    "lambdaFunction": "<staging-lambda-name>-dev",
    "region": "ap-northeast-2",
    "s3Region": "ap-southeast-1",
    "gpuHost": "<dev-instance-ssh-host>",
    "branch": "develop",
    "distributions": { "training": "<dev-training-distro-id>", "live-fast": "<dev-livefast-distro-id>", "chatbot": "<dev-livefast-distro-id>" },
    "clientTargets": { "training": "<dev-training-origin-s3-uri>", "live-fast": "<dev-livefast-origin-s3-uri>", "chatbot": "<dev-livefast-origin-s3-uri>" }
  },
  "staging": {
    "lambdaFunction": "<staging-lambda-name>",
    "region": "ap-northeast-2",
    "s3Region": "ap-southeast-1",
    "gpuHost": "<staging-instance-ssh-host>",
    "branch": "main",
    "distributions": { "training": "E2KTGN0G56FW71", "live-fast": "<livefast-distro-id>", "chatbot": "<livefast-distro-id>" },
    "clientTargets": { "training": "<staging-training-origin-s3-uri>", "live-fast": "<staging-livefast-origin-s3-uri>", "chatbot": "<staging-livefast-origin-s3-uri>" }
  }
}
```

- [ ] **Step 2: Per-env client env files**

Vite loads `.env.<mode>.local` above `.env.<mode>`, so the deploy script drops the right file in as `.local` before building — modes stay `training`/`live-fast`/`chatbot` and no client code changes. Six files, e.g. `client/env/dev/training.env`:

```
VITE_APP_MODE=training
VITE_APP_BASENAME=/
VITE_API_BASE_URL=https://<dev-training-domain>
VITE_GPU_WORKER_URL=https://<dev-training-domain>
VITE_LIVE_GATEWAY_URL=https://<dev-training-domain>
```

`client/env/dev/live-fast.env` and `chatbot.env` are the same shape with `VITE_APP_MODE=live-fast|chatbot` and the `<dev-livefast-domain>`. The three `client/env/staging/*.env` files use the current production values verbatim (`d3dghqhnk7aoku` for training, `doovx82fh9tfs` for live-fast/chatbot) — copy them from the existing staging build env files (`client/.env.training` etc.) if those exist on disk, so staging builds stay byte-identical.

- [ ] **Step 3: `scripts/deploy-client.ps1`**

```powershell
param(
  [Parameter(Mandatory)][ValidateSet('dev','staging')] [string]$Env,
  [Parameter(Mandatory)][ValidateSet('training','live-fast','chatbot')] [string]$Mode,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$cfg = (Get-Content "$PSScriptRoot\deploy.config.json" -Raw | ConvertFrom-Json).$Env
$repo = Resolve-Path "$PSScriptRoot\.."
$envSrc = "$repo\client\env\$Env\$Mode.env"
$envDst = "$repo\client\.env.$Mode.local"
$dist = "$repo\client\dist-$Mode"
$target = $cfg.clientTargets.$Mode
$distro = $cfg.distributions.$Mode

if ($DryRun) {
  Write-Host "[dry-run] build client --mode $Mode with $envSrc; sync $dist -> $target; invalidate $distro"
  exit 0
}
Copy-Item $envSrc $envDst -Force
try {
  Push-Location "$repo\client"
  npm run "build:$Mode"
  if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
  Pop-Location
} finally {
  Remove-Item $envDst -Force -ErrorAction SilentlyContinue
}
aws s3 sync $dist $target --delete --region $cfg.s3Region
if ($LASTEXITCODE -ne 0) { throw "s3 sync failed" }
aws cloudfront create-invalidation --distribution-id $distro --paths "/*"
Write-Host "Deployed $Mode client to $Env"
```

- [ ] **Step 4: `scripts/deploy-lambda.ps1`**

```powershell
param(
  [Parameter(Mandatory)][ValidateSet('dev','staging')] [string]$Env,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$cfg = (Get-Content "$PSScriptRoot\deploy.config.json" -Raw | ConvertFrom-Json).$Env
$repo = Resolve-Path "$PSScriptRoot\.."

if ($DryRun) { Write-Host "[dry-run] package lambda; update-function-code $($cfg.lambdaFunction)"; exit 0 }
Push-Location "$repo\lambda"
npm run package:function-url
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "package failed" }
Pop-Location
aws lambda update-function-code --region $cfg.region --function-name $cfg.lambdaFunction --zip-file "fileb://$repo/lambda/.dist/voice-cloning-function-url.zip"
if ($LASTEXITCODE -ne 0) { throw "update-function-code failed" }
Write-Host "Deployed lambda to $Env ($($cfg.lambdaFunction))"
```

- [ ] **Step 5: `scripts/deploy-worker.ps1`**

Deploys workers + live gateway by pulling the env's branch on the right host and restarting units. Unit names: use the exact ones discovered in Task 4 Step 2 (adjust the `$units` list to match):

```powershell
param(
  [Parameter(Mandatory)][ValidateSet('dev','staging')] [string]$Env,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$cfg = (Get-Content "$PSScriptRoot\deploy.config.json" -Raw | ConvertFrom-Json).$Env
$units = 'gpu-worker gpu-inference-worker live-gateway'
$remote = "cd /path/to/repo && git fetch origin && git checkout $($cfg.branch) && git pull && sudo systemctl restart $units && sleep 3 && curl -sf localhost:3001/healthz && curl -sf localhost:3003/healthz && curl -sf localhost:3002/healthz"

if ($DryRun) { Write-Host "[dry-run] ssh $($cfg.gpuHost): $remote"; exit 0 }
ssh $cfg.gpuHost $remote
if ($LASTEXITCODE -ne 0) { throw "remote deploy failed" }
Write-Host "Deployed workers to $Env ($($cfg.gpuHost), branch $($cfg.branch))"
```

Replace `/path/to/repo` and the `$units` list with the real on-host repo path and unit names from Task 4 before committing.

- [ ] **Step 6: Dry-run both envs**

```powershell
.\scripts\deploy-client.ps1 -Env dev -Mode training -DryRun
.\scripts\deploy-client.ps1 -Env staging -Mode chatbot -DryRun
.\scripts\deploy-lambda.ps1 -Env dev -DryRun
.\scripts\deploy-worker.ps1 -Env staging -DryRun
```

Expected: each prints the correct env-specific function/bucket/distro/host with no cross-contamination (dev command never mentions a staging resource and vice versa).

- [ ] **Step 7: Commit**

```powershell
git add scripts/deploy.config.json scripts/deploy-*.ps1 client/env; git commit -m "feat: per-environment deploy scripts (dev/staging)"
```

---

### Task 11: First real dev deploy + end-to-end verification

**Interfaces:**
- Consumes: everything. This is the spec's Verification section executed for real.

- [ ] **Step 1: Deploy `develop` to dev**

```powershell
.\scripts\deploy-lambda.ps1 -Env dev
.\scripts\deploy-client.ps1 -Env dev -Mode training
.\scripts\deploy-client.ps1 -Env dev -Mode chatbot
.\scripts\deploy-worker.ps1 -Env dev
```

- [ ] **Step 2: Dev smoke test (browser, over `https://<dev-training-domain>`)**

1. Voice list loads (proves Lambda → S3 `echolect-dev/` path + CORS).
2. Seeded voice: run one TTS inference to completion (proves worker → ALB → SSE relay).
3. Upload a short audio file and run the first training step (Slice) with live SSE progress.
4. On `https://<dev-livefast-domain>`: start a live chat session, hear a spoken reply (proves live gateway WSS path).

- [ ] **Step 3: Stop/start resilience**

```powershell
aws ec2 stop-instances --region ap-northeast-2 --instance-ids <dev-instance-id>
```

Confirm the dev frontend shows the GPU-stopped state gracefully; then start it (via the app's start flow if exposed, else CLI) and confirm the ALB target returns to healthy and inference works again.

- [ ] **Step 4: Staging untouched check**

On the real user URLs (`d3dghqhnk7aoku` / `doovx82fh9tfs`): voice list loads, one inference plays, live chat answers. Verify staging Lambda config unchanged:

```powershell
aws lambda get-function-configuration --region ap-northeast-2 --function-name <staging-lambda-name> --query "LastModified"
```

Expected: timestamp predates today's work.

- [ ] **Step 5: Fix-forward and commit anything found**

Any failure here → fix on `develop`, redeploy with the scripts, re-verify, commit with a descriptive message.

---

### Task 12: Runbook + vault sync

**Files:**
- Modify: `docs/environments.md` (fill `## Runbooks`)
- Modify: `CLAUDE.md` (two-line pointer under Commands: deploy scripts + branch model)
- Modify (vault): `…\Obsidian Vault\Voice Cloning Studio\Components\Infrastructure & Deployment.md`

- [ ] **Step 1: Write the runbooks section**

Fill `## Runbooks` in `docs/environments.md` with the exact working commands from Tasks 10–11:

```markdown
## Runbooks

### Start / stop the dev GPU
aws ec2 start-instances --region ap-northeast-2 --instance-ids <dev-instance-id>
aws ec2 stop-instances  --region ap-northeast-2 --instance-ids <dev-instance-id>
(Idle auto-stop after 30 min via the dev Lambda; nightly stop 21:00 KST via EventBridge `vcs-dev-gpu-nightly-stop`.)

### Deploy to dev (from `develop`)
.\scripts\deploy-lambda.ps1 -Env dev
.\scripts\deploy-client.ps1 -Env dev -Mode training   # and/or -Mode chatbot / live-fast
.\scripts\deploy-worker.ps1 -Env dev

### Promote to staging
1. PR / merge `develop` → `main` after dev verification.
2. Same three scripts with `-Env staging`.
```

- [ ] **Step 2: CLAUDE.md pointer**

Add under the Commands section:

```markdown
### Deploy
`scripts/deploy-{client,lambda,worker}.ps1 -Env dev|staging` — `develop` branch → dev env, `main` → staging. Matrix + runbooks: `docs/environments.md`.
```

- [ ] **Step 3: Vault component note**

In `Components/Infrastructure & Deployment.md`, add a short `## Environments` section: two environments (staging = users, dev = programmers), full-mirror architecture, `echolect-dev/` prefix isolation, dev GPU stopped by default (idle-stop + nightly stop), deploy scripts + branch model, pointer to `docs/environments.md` for the live matrix.

- [ ] **Step 4: Commit**

```powershell
git add docs/environments.md CLAUDE.md; git commit -m "docs: environment runbooks + deploy pointers"
```

---

## Self-Review

- **Spec coverage:** staging relabel/tagging (T2), AMI-cloned dev EC2 (T3–4), dev ALB (T5), dev Lambda + scoped IAM (T6), dev CloudFront ×2 + client hosting (T7) — the spec said one distro but staging factually has two frontends, so full-mirror means two; CORS + one-time seed (T8), nightly auto-stop + on-demand usage (T9, idle-stop noted in T6), branch + deploy scripts + per-env config (T1, T10), verification checklist (T11), matrix doc + runbook + vault sync (T12). Spec's "new dev bucket" superseded by the user-approved prefix decision, noted in the header.
- **Placeholder scan:** all `<angle-bracket>` values are discovery outputs with the exact command that produces them and the matrix row that stores them — no TBDs. The two literal `placeholder-until-task8` env values are intentional staged wiring, resolved in Task 8 Step 1.
- **Type consistency:** script names, config keys (`lambdaFunction`, `clientTargets`, `distributions`), env file paths, and branch names are used identically across Tasks 1, 10, 11, 12.
