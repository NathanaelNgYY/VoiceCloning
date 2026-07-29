# Dev + Staging Environments — Design

**Date:** 2026-07-06
**Status:** Approved (design review with Nathanael, 2026-07-06)

## Goal

Give programmers a development environment they can freely break, while users keep using a
stable environment ("staging"). Two GPU EC2 instances total: the existing production g6.xlarge
becomes the staging environment; one new GPU EC2 is added for development.

## Decisions (from design review)

| Question | Decision |
|---|---|
| Instance topology | Existing live EC2 = staging; add **one** new GPU EC2 for dev (2 total) |
| Isolation level | **Fully separate stack** — dev gets its own S3 buckets, Lambda, CloudFront, ALB, EC2 |
| Dev GPU uptime | **Start/stop on demand**, with a nightly auto-stop safety net |
| Deploy flow | **Git branches + manual deploy scripts** (`develop` → dev, `main` → staging); no CI/CD yet |
| Dev architecture | **Full mirror of staging** (`STORAGE_MODE=s3`), not local mode |
| Dev data | **Seed once** from staging's bucket via `aws s3 sync`; buckets drift independently after |

## Environment layout

### Staging (existing — no AWS changes)

The current production stack is relabeled staging; users keep using it unchanged:

- GPU EC2 g6.xlarge (L4) running training worker, inference worker, live gateway (systemd)
- Lambda router + Function URL behind CloudFront (OAC, `AWS_IAM`)
- Data S3 bucket, client S3 bucket, CloudFront distribution `E2KTGN0G56FW71`, ALB for SSE/WSS
- Only change: tag all resources `Environment=staging` for cost tracking

### Dev (new — parallel copy, every resource suffixed `-dev`, tagged `Environment=dev`)

| Resource | How it's created |
|---|---|
| GPU EC2 g6.xlarge | **Launch from an AMI snapshot of the staging instance** — clones the GPT-SoVITS install, conda env, base models, and systemd units in one step. Same region (ap-northeast-2). |
| Data S3 bucket | New `<bucket>-dev`; one-time `aws s3 sync s3://<staging-bucket> s3://<bucket>-dev` so devs have trained voices on day one |
| Lambda router | Separate `-dev` function, same code package; env vars point at the dev bucket and dev worker host; own Function URL with the same OAC/`AWS_IAM` pattern |
| ALB | Small dev ALB targeting the dev EC2, so CloudFront SSE/WSS behaviors mirror staging exactly (~$20/mo) |
| CloudFront + client bucket | New dev distribution + dev client bucket; identical behavior order: `/api/*` → dev Lambda Function URL, SSE/WSS paths → dev ALB, default → dev client bucket |

Dev runs `STORAGE_MODE=s3` exactly like staging — no "works in dev, breaks in staging"
surprises in the presigned-URL / SSE-relay / Lambda-routing paths.

## Dev GPU cost control

- Dev EC2 is **stopped by default**. Developers start it via console/CLI or the app's existing
  instance-lifecycle handling in the Lambda router (pointed at the dev instance ID).
- **EventBridge rule auto-stops the dev instance nightly** (e.g., 21:00 KST) so a forgotten
  instance never runs overnight/weekends unnoticed.
- Stopped cost is EBS-only (a few $/mo). Running cost ≈ $1/hr on-demand.
- ALB target group registers the instance by ID, so stop/start cycles need no re-wiring.

## Branch & deploy flow

- **Branches:** `main` deploys to staging; new long-lived `develop` branch deploys to dev.
  Feature branches merge into `develop`; after verification on the dev environment,
  `develop` merges into `main` and staging is deployed.
- **Deploy scripts** (in `scripts/`), one per component, environment picked by flag:
  - `deploy-client.ps1 -Env dev|staging` — Vite build with per-env vars (`.env.dev` /
    `.env.staging`: `VITE_API_BASE_URL`, `VITE_GPU_WORKER_URL` per environment), sync to the
    right client bucket, CloudFront invalidation. Covers both `build` and `build:chatbot`
    (kiosk `dist-chatbot`) targets.
  - `deploy-lambda.ps1 -Env dev|staging` — `npm run package:function-url` + `aws lambda
    update-function-code` on the right function.
  - `deploy-worker.ps1 -Env dev|staging` — SSH to the right EC2: `git pull` the right branch,
    restart the systemd units (workers + live gateway).
- **Per-env config:** parallel `.env` files alongside the existing `.env.*.deployment` files,
  plus a matrix doc listing every value that differs per environment (bucket names, instance
  ID, worker host, Function URL, CloudFront domain).

## IAM & safety boundaries

- Dev Lambda role is scoped to the **dev** bucket and start/stop on the **dev** instance only —
  nothing dev-side can touch staging data.
- Developer IAM users get `ec2:StartInstances`/`StopInstances` on the dev instance.
- Staging deploys remain gated by whoever holds staging deploy credentials + the `main` merge.

## Error handling / gotchas

- Client GPU-status polling and the "GPU stopping" overlay already handle a stopped/starting
  instance gracefully (recent commits `7351b5d`, `a34ba95`).
- The AMI must be taken while the staging pipeline is idle (no training job mid-flight) to
  avoid snapshotting partial job state; worker state is in-memory so a stopped-idle snapshot
  is clean.
- After AMI launch, the dev EC2's `.env.*.deployment` files must be edited on-host to point at
  the dev bucket before first start (they'll contain staging values from the snapshot).
- Pronunciation hot dict (`engdict-hot.rep`) lives on-host; the AMI copies it, but future
  staging dict edits won't propagate to dev automatically.

## Verification

1. Smoke-test dev end-to-end over the dev CloudFront domain: upload audio → at least one
   training step with SSE progress, a full inference, and a live chat session.
2. Confirm the seeded voices from staging load and infer correctly in dev.
3. Confirm staging still serves users unchanged (spot-check inference + live chat).
4. Stop/start the dev instance and confirm the app recovers (ALB target healthy, overlay
   clears).

## Cost summary

Ongoing added cost ≈ **$20–30/mo** (dev ALB + EBS + trivial S3/Lambda/CloudFront), plus
**~$1/hr only while the dev GPU is running**.

## Out of scope (YAGNI)

- CI/CD (GitHub Actions) — deploy scripts are designed so this can be bolted on later.
- A third "production" environment separate from staging.
- Multi-user readiness / queueing (see `docs/multi-user-readiness.md`) — unchanged.
- Infrastructure-as-Code (Terraform/CloudFormation) — resources are created once by hand;
  revisit if environments multiply.
