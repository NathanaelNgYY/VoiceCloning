# VoiceCloning Container Images

Last updated: 2026-05-15

This guide documents the current split deployment. Training and inference now run as separate GPU container images. It does not use Docker Compose.

## Final Image Set

| Image | Dockerfile | Purpose | Runtime |
| --- | --- | --- | --- |
| `voice-gpu-worker` | `gpu-worker/Dockerfile` | Training worker. Handles training, transcription, training audio browsing, and worker activity. | GPU EC2, ECS on GPU EC2 capacity, or future training-specific platform |
| `voice-gpu-inference-worker` | `gpu-inference-worker/Dockerfile` | Inference worker. Handles model loading, GPT-SoVITS inference, inference artifacts, and inference activity. | GPU EC2, ECS on GPU EC2 capacity, or future inference-specific platform |
| `voice-lambda-api` | `lambda/Dockerfile` | Lambda Function URL backend. Routes training calls to the training worker and inference/model calls to the inference worker. | AWS Lambda container image |
| `voice-live-gateway` | `live-gateway/Dockerfile` | WebSocket and OpenAI Realtime gateway. | EC2, ECS/Fargate, or any normal container host |

The frontend is intentionally not one of these images. The deployed frontend should stay as static files on S3 plus CloudFront unless a separate local-only Nginx image is needed later.

## Route Ownership

`voice-gpu-worker` owns:

- `POST /train`
- `POST /train/stop`
- `GET /train/current`
- `GET /train/progress/:sessionId`
- `POST /transcribe`
- `GET /training-audio/:expName`
- `GET /training-audio/file/:expName/:filename`
- `GET /activity/status`
- `GET /healthz`

`voice-gpu-inference-worker` owns:

- `GET /models`
- `POST /models/download`
- `POST /ref-audio/download`
- `POST /inference/start`
- `POST /inference/stop`
- `GET /inference/status`
- `POST /inference/weights/gpt`
- `POST /inference/weights/sovits`
- `POST /inference/tts`
- `POST /inference`
- `POST /inference/generate`
- `GET /inference/progress/:sessionId`
- `POST /inference/cancel`
- `GET /inference/current`
- `GET /inference/result/:sessionId`
- `GET /ref-audio`
- `GET /activity/status`
- `GET /healthz`

`voice-lambda-api` routes:

- training requests to `GPU_WORKER_URL`
- inference and model requests to `INFERENCE_WORKER_URL`

Until `INFERENCE_WORKER_URL` is set, Lambda falls back to `GPU_WORKER_URL`. That fallback is useful during rollout, but a true split deployment is not complete until `INFERENCE_WORKER_URL` is configured.

## Recommended Deploy Shape

Use this order:

1. Prepare `docker/vendor/GPT-SoVITS.zip`
2. Build all four images from the repo root
3. Push all four images to ECR
4. Deploy the training worker
5. Deploy the inference worker
6. Update public routing so browser training paths hit training and browser inference paths hit inference
7. Update Lambda env vars to include both worker URLs, then deploy the Lambda image
8. Deploy the live gateway
9. Run the verification checklist

For the first rollout, the simplest split is:

- training container on host port `3001`
- inference container on host port `3003`
- Lambda pointing to both private endpoints separately
- one shared public CloudFront or ALB domain for worker-facing browser paths

If training and inference need real runtime isolation, move them to separate GPU hosts or separate GPU-backed services. Splitting the images alone does not eliminate GPU contention if both containers still share one GPU machine.

## Prerequisites

Install these on the machine that builds or runs the containers:

- Docker
- AWS CLI, if pulling GPT-SoVITS from S3 or pushing to ECR
- NVIDIA driver and NVIDIA Container Toolkit for the GPU images
- Access to the project S3 bucket if downloading the prepared GPT-SoVITS bundle

For real GPU testing, use the GPU EC2 instance through SSM. A normal laptop can build and run `voice-lambda-api` and `voice-live-gateway`, but it usually cannot validate GPT-SoVITS CUDA training or inference.

## Step 1: Prepare GPT-SoVITS For Both GPU Images

The repo does not store GPT-SoVITS directly. Both GPU image builds expect the prepared bundle here before build:

```text
docker/vendor/GPT-SoVITS.zip
```

On the GPU EC2, download the prepared bundle from S3:

```bash
cd ~/VoiceCloning
mkdir -p docker/vendor
aws s3 cp \
  s3://interns2026-small-projects-bucket-shared/echolect/GPT-SoVITS.zip \
  docker/vendor/GPT-SoVITS.zip \
  --region ap-southeast-1
```

Check that the file exists:

```bash
ls -lh docker/vendor/GPT-SoVITS.zip
```

Both GPU Dockerfiles unzip this bundle into `/opt/gpt-sovits`, create `/opt/gpt-sovits/venv`, install Python dependencies, and set defaults similar to:

```env
GPT_SOVITS_ROOT=/opt/gpt-sovits
PYTHON_EXEC=/opt/gpt-sovits/venv/bin/python
INFERENCE_HOST=127.0.0.1
INFERENCE_PORT=9880
WORKER_HOST=0.0.0.0
WORKER_PORT=3001
```

## Step 2: Build All Images

Run these from the repository root.

```bash
docker build \
  -f gpu-worker/Dockerfile \
  -t voice-gpu-worker:local \
  .

docker build \
  -f gpu-inference-worker/Dockerfile \
  -t voice-gpu-inference-worker:local \
  .

docker build \
  -f lambda/Dockerfile \
  -t voice-lambda-api:local \
  .

docker build \
  -f live-gateway/Dockerfile \
  -t voice-live-gateway:local \
  .
```

Do not use `docker build .` at the repo root. The root [Dockerfile](C:/Users/User/Downloads/VoiceCloningProjectV1/VoiceCloning/Dockerfile:1) now exits with per-service build instructions so the old deleted layout is not built by accident.

## Step 3: Push Images To ECR

Set variables:

```bash
AWS_REGION=ap-northeast-2
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

Create repositories once:

```bash
aws ecr create-repository --repository-name voice-gpu-worker --region "$AWS_REGION"
aws ecr create-repository --repository-name voice-gpu-inference-worker --region "$AWS_REGION"
aws ecr create-repository --repository-name voice-lambda-api --region "$AWS_REGION"
aws ecr create-repository --repository-name voice-live-gateway --region "$AWS_REGION"
```

Log in:

```bash
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
```

Tag and push:

```bash
docker tag voice-gpu-worker:local "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-worker:latest"
docker tag voice-gpu-inference-worker:local "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-inference-worker:latest"
docker tag voice-lambda-api:local "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-lambda-api:latest"
docker tag voice-live-gateway:local "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-live-gateway:latest"

docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-worker:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-inference-worker:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-lambda-api:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-live-gateway:latest"
```

## Optional: Use `tmux` For Long-Running Sessions

If you are testing through SSM and do not want long-running container processes or log tails to disappear when the terminal refreshes or disconnects, run them inside `tmux`.

Common commands:

```bash
tmux new -s split-test
tmux ls
tmux attach -t split-test
tmux kill-session -t split-test
```

Detach from a running `tmux` session without stopping the work:

```text
Ctrl+b then d
```

One simple workflow is:

```bash
tmux new -s training
# start or inspect the training container here

tmux new -s inference
# start or inspect the inference container here

tmux new -s lambda-test
# run the local Lambda image test here

tmux new -s logs
# tail docker logs here
```

Example log tail inside `tmux`:

```bash
tmux new -s logs
docker logs -f voice-gpu-worker
```

Open another session for inference logs:

```bash
tmux new -s inference-logs
docker logs -f voice-gpu-inference-worker
```

## Step 4: Deploy The Training Worker

Create a runtime env file on the GPU host:

```bash
cat > /etc/voice-gpu-worker.env <<'EOF'
NODE_ENV=production
WORKER_HOST=0.0.0.0
WORKER_PORT=3001

GPT_SOVITS_ROOT=/opt/gpt-sovits
PYTHON_EXEC=/opt/gpt-sovits/venv/bin/python
INFERENCE_HOST=127.0.0.1
INFERENCE_PORT=9880
LOCAL_TEMP_ROOT=/opt/gpt-sovits/worker_temp

S3_BUCKET=interns2026-small-projects-bucket-shared
S3_REGION=ap-southeast-1
S3_PREFIX=echolect/
CORS_ORIGIN=https://TRAINING_CLOUDFRONT_DOMAIN,https://LIVE_FAST_CLOUDFRONT_DOMAIN

# Optional email notifications for training completion
EMAIL_USER=REPLACE_IF_USED
EMAIL_PASS=REPLACE_IF_USED
EMAIL_FROM=REPLACE_IF_USED
EOF
```

Pull and run the training container:

```bash
docker pull "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-worker:latest"

docker rm -f voice-gpu-worker 2>/dev/null || true
docker run -d \
  --name voice-gpu-worker \
  --restart unless-stopped \
  --gpus all \
  --env-file /etc/voice-gpu-worker.env \
  -p 3001:3001 \
  "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-worker:latest"
```

Smoke-test the training worker:

```bash
curl http://127.0.0.1:3001/healthz
curl http://127.0.0.1:3001/activity/status
curl http://127.0.0.1:3001/train/current
docker exec voice-gpu-worker nvidia-smi
docker exec voice-gpu-worker \
  /opt/gpt-sovits/venv/bin/python -c "import torch; print(torch.__version__); print(torch.cuda.is_available())"
```

## Step 5: Deploy The Inference Worker

Create a runtime env file on the inference GPU host. If training and inference share one machine for the first rollout, keep container port `3001` inside the container and publish it on host port `3003`.

```bash
cat > /etc/voice-gpu-inference-worker.env <<'EOF'
NODE_ENV=production
WORKER_HOST=0.0.0.0
WORKER_PORT=3001

GPT_SOVITS_ROOT=/opt/gpt-sovits
PYTHON_EXEC=/opt/gpt-sovits/venv/bin/python
INFERENCE_HOST=127.0.0.1
INFERENCE_PORT=9880
LOCAL_TEMP_ROOT=/opt/gpt-sovits/worker_temp

S3_BUCKET=interns2026-small-projects-bucket-shared
S3_REGION=ap-southeast-1
S3_PREFIX=echolect/
CORS_ORIGIN=https://TRAINING_CLOUDFRONT_DOMAIN,https://LIVE_FAST_CLOUDFRONT_DOMAIN
EOF
```

If training and inference share one host:

```bash
docker pull "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-inference-worker:latest"

docker rm -f voice-gpu-inference-worker 2>/dev/null || true
docker run -d \
  --name voice-gpu-inference-worker \
  --restart unless-stopped \
  --gpus all \
  --env-file /etc/voice-gpu-inference-worker.env \
  -p 3003:3001 \
  "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-inference-worker:latest"
```

If inference has its own host, publish it normally on `3001` instead:

```bash
docker run -d \
  --name voice-gpu-inference-worker \
  --restart unless-stopped \
  --gpus all \
  --env-file /etc/voice-gpu-inference-worker.env \
  -p 3001:3001 \
  "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-inference-worker:latest"
```

Smoke-test the inference worker. Use the host port you actually published:

```bash
INFERENCE_TEST_PORT=3003

curl "http://127.0.0.1:${INFERENCE_TEST_PORT}/healthz"
curl "http://127.0.0.1:${INFERENCE_TEST_PORT}/activity/status"
curl "http://127.0.0.1:${INFERENCE_TEST_PORT}/models"
curl -X POST "http://127.0.0.1:${INFERENCE_TEST_PORT}/inference/start"
curl "http://127.0.0.1:${INFERENCE_TEST_PORT}/inference/status"
docker exec voice-gpu-inference-worker nvidia-smi
docker exec voice-gpu-inference-worker \
  /opt/gpt-sovits/venv/bin/python -c "import torch; print(torch.__version__); print(torch.cuda.is_available())"
```

## Step 6: Update Public Routing

This step matters because the current frontend still has one `VITE_GPU_WORKER_URL`. The easiest way to keep the frontend working is to expose one public worker-facing domain and split by path behind it.

Recommended public routing:

- `/train/progress/*` -> training worker
- `/training-audio/*` -> training worker
- `/inference/progress/*` -> inference worker
- `/inference/result/*` -> inference worker when direct worker artifacts are used
- `/ref-audio*` -> inference worker when direct worker artifacts are used

If you use CloudFront in front of worker traffic, one simple pattern is:

- public worker domain: `https://WORKER_PUBLIC_DOMAIN`
- `VITE_GPU_WORKER_URL=https://WORKER_PUBLIC_DOMAIN`
- CloudFront behavior `/train/progress/*` -> training origin
- CloudFront behavior `/training-audio/*` -> training origin
- CloudFront behavior `/inference/progress/*` -> inference origin
- CloudFront behavior `/inference/result/*` -> inference origin
- CloudFront behavior `/ref-audio*` -> inference origin

If you expose training and inference on two different public domains instead of one shared path-routed domain, the current frontend needs code changes before deployment. Do not point `VITE_GPU_WORKER_URL` directly at the training-only worker after the split, or browser inference SSE will fail.

## Step 7: Update Lambda API For The Split

Set the Lambda env vars so training and inference go to different backends:

```env
S3_BUCKET=interns2026-small-projects-bucket-shared
S3_REGION=ap-southeast-1
S3_PREFIX=echolect/

GPU_WORKER_URL=http://TRAINING_PRIVATE_IP_OR_INTERNAL_ALB
GPU_WORKER_PUBLIC_URL=https://WORKER_PUBLIC_DOMAIN

INFERENCE_WORKER_URL=http://INFERENCE_PRIVATE_IP_OR_INTERNAL_ALB
INFERENCE_WORKER_PUBLIC_URL=https://WORKER_PUBLIC_DOMAIN

MODEL_SOURCE=s3
ARTIFACT_SOURCE=s3
CORS_ORIGIN=https://TRAINING_CLOUDFRONT_DOMAIN,https://LIVE_FAST_CLOUDFRONT_DOMAIN
```

Notes:

- `GPU_WORKER_URL` is the training worker private URL
- `INFERENCE_WORKER_URL` is the inference worker private URL
- when using one shared public worker domain, both public URLs can be the same domain because public path routing decides which origin receives the request
- if `ARTIFACT_SOURCE=s3`, `INFERENCE_WORKER_PUBLIC_URL` is still safe to set and keeps the deployment ready for direct-worker artifact mode

Example Lambda config update:

```bash
aws lambda update-function-configuration \
  --region ap-northeast-2 \
  --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project \
  --environment "Variables={S3_BUCKET=interns2026-small-projects-bucket-shared,S3_REGION=ap-southeast-1,S3_PREFIX=echolect/,GPU_WORKER_URL=http://TRAINING_PRIVATE_IP_OR_INTERNAL_ALB,GPU_WORKER_PUBLIC_URL=https://WORKER_PUBLIC_DOMAIN,INFERENCE_WORKER_URL=http://INFERENCE_PRIVATE_IP_OR_INTERNAL_ALB,INFERENCE_WORKER_PUBLIC_URL=https://WORKER_PUBLIC_DOMAIN,MODEL_SOURCE=s3,ARTIFACT_SOURCE=s3,CORS_ORIGIN=https://TRAINING_CLOUDFRONT_DOMAIN,https://LIVE_FAST_CLOUDFRONT_DOMAIN}"
```

Before updating the real AWS Lambda function, you can dry-run the Lambda image directly on EC2 or your local machine.

### Dry-Run The Lambda Image Before AWS Deployment

If the training and inference containers are running on the same EC2 host as published ports `3001` and `3003`, create this env file:

```bash
cat > /etc/voice-lambda-api-test.env <<'EOF'
S3_BUCKET=interns2026-small-projects-bucket-shared
S3_REGION=ap-southeast-1
S3_PREFIX=echolect/

GPU_WORKER_URL=http://host.docker.internal:3001
GPU_WORKER_PUBLIC_URL=http://localhost:3001

INFERENCE_WORKER_URL=http://host.docker.internal:3003
INFERENCE_WORKER_PUBLIC_URL=http://localhost:3003

MODEL_SOURCE=s3
ARTIFACT_SOURCE=s3
CORS_ORIGIN=http://localhost:5173
EOF
```

If the training and inference containers run on different hosts, replace `host.docker.internal` with the real private IP or internal ALB DNS names for each host.

Run the Lambda image test container:

```bash
docker rm -f voice-lambda-api-test 2>/dev/null || true
docker run -d \
  --name voice-lambda-api-test \
  --env-file /etc/voice-lambda-api-test.env \
  --add-host=host.docker.internal:host-gateway \
  -p 9000:8080 \
  "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-lambda-api:latest"
```

Invoke the local Lambda runtime with representative requests:

```bash
curl -s \
  -X POST "http://127.0.0.1:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d '{"rawPath":"/api/config","requestContext":{"http":{"method":"GET","path":"/api/config"}}}'

curl -s \
  -X POST "http://127.0.0.1:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d '{"rawPath":"/api/train/current","requestContext":{"http":{"method":"GET","path":"/api/train/current"}}}'

curl -s \
  -X POST "http://127.0.0.1:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d '{"rawPath":"/api/models","requestContext":{"http":{"method":"GET","path":"/api/models"}}}'

curl -s \
  -X POST "http://127.0.0.1:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d '{"rawPath":"/api/inference/current","requestContext":{"http":{"method":"GET","path":"/api/inference/current"}}}'

curl -s \
  -X POST "http://127.0.0.1:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d '{"rawPath":"/api/inference/status","requestContext":{"http":{"method":"GET","path":"/api/inference/status"}}}'
```

Expected behavior:

- `/api/train/current` is served through the training worker
- `/api/models`, `/api/inference/current`, and `/api/inference/status` are served through the inference worker
- `/api/config` still reports the backend config successfully

Check the Lambda test container logs if any request fails:

```bash
docker logs -f voice-lambda-api-test
```

Then deploy the Lambda image:

```bash
aws lambda update-function-code \
  --region ap-northeast-2 \
  --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project \
  --image-uri "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-lambda-api:latest"
```

## Step 8: Deploy The Live Gateway

Create the runtime env file:

```bash
cat > /etc/voice-live-gateway.env <<'EOF'
NODE_ENV=production
PORT=3002
CORS_ORIGIN=https://TRAINING_CLOUDFRONT_DOMAIN,https://LIVE_FAST_CLOUDFRONT_DOMAIN

OPENAI_API_KEY=REPLACE_WITH_BACKEND_ONLY_OPENAI_KEY
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VAD=semantic_vad
OPENAI_REALTIME_SYSTEM_PROMPT=You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.
EOF
```

Pull and run it:

```bash
docker pull "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-live-gateway:latest"

docker rm -f voice-live-gateway 2>/dev/null || true
docker run -d \
  --name voice-live-gateway \
  --restart unless-stopped \
  --env-file /etc/voice-live-gateway.env \
  -p 3002:3002 \
  "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-live-gateway:latest"
```

Health check:

```bash
curl http://127.0.0.1:3002/healthz
```

In production, this service should be behind an ALB or CloudFront behavior that supports WebSocket upgrade headers. Route `/api/live/chat/realtime` to `voice-live-gateway`, not Lambda.

## Step 9: Frontend Configuration

For the current client, the safest split deployment is still a single public worker domain for browser-facing worker traffic.

Typical frontend env values:

```env
VITE_API_BASE_URL=https://LIVE_FAST_CLOUDFRONT_DOMAIN
VITE_GPU_WORKER_URL=https://WORKER_PUBLIC_DOMAIN
VITE_LIVE_GATEWAY_URL=https://LIVE_FAST_CLOUDFRONT_DOMAIN
```

Do not leave `VITE_GPU_WORKER_URL` pointing directly at the training-only worker after the split unless your public routing layer already forwards inference paths to the inference worker.

## Step 10: Verification Checklist

Run this after deployment.

### Direct training worker checks

```bash
curl "$TRAINING_URL/healthz"
curl "$TRAINING_URL/activity/status"
curl "$TRAINING_URL/train/current"
```

Start one real training job and confirm:

- the request reaches `voice-gpu-worker`
- `/train/current` reports the active session
- `/train/progress/:sessionId` streams events

### Direct inference worker checks

```bash
curl "$INFERENCE_URL/healthz"
curl "$INFERENCE_URL/activity/status"
curl "$INFERENCE_URL/models"
curl -X POST "$INFERENCE_URL/inference/start"
curl "$INFERENCE_URL/inference/status"
curl "$INFERENCE_URL/inference/current"
```

Run one real inference flow and confirm:

- model listing works
- model loading hits `voice-gpu-inference-worker`
- `/inference/progress/:sessionId` streams events
- `/inference/result/:sessionId` resolves

### Lambda checks

Invoke these through the real Lambda Function URL or API base:

```bash
curl "$API/api/config"
curl "$API/api/train/current"
curl "$API/api/inference/current"
curl "$API/api/models"
curl "$API/api/inference/status"
```

Confirm:

- training endpoints hit the training worker
- `/api/models` and inference endpoints hit the inference worker
- Lambda no longer relies on `GPU_WORKER_URL` for inference traffic
- the Lambda container image behaves the same in direct `docker run` testing and in the real AWS Lambda deployment

### Browser checks

Confirm in the real frontend:

- training page can upload audio, start training, and receive training SSE
- live or inference page can load models and receive inference SSE
- generated audio download or playback works
- WebSocket live chat still connects through `voice-live-gateway`

### Log checks

Watch all three services while testing:

```bash
docker logs -f voice-gpu-worker
docker logs -f voice-gpu-inference-worker
docker logs -f voice-live-gateway
```

You should see:

- training requests only in `voice-gpu-worker`
- inference and model requests only in `voice-gpu-inference-worker`
- live chat traffic only in `voice-live-gateway`

## Local Lambda Split Test

To test the split locally without AWS routing, start both GPU containers and point Lambda at both:

```bash
cat > /tmp/voice-lambda-api.env <<'EOF'
S3_BUCKET=interns2026-small-projects-bucket-shared
S3_REGION=ap-southeast-1
S3_PREFIX=echolect/

GPU_WORKER_URL=http://host.docker.internal:3001
GPU_WORKER_PUBLIC_URL=http://localhost:3001

INFERENCE_WORKER_URL=http://host.docker.internal:3003
INFERENCE_WORKER_PUBLIC_URL=http://localhost:3003

MODEL_SOURCE=s3
ARTIFACT_SOURCE=s3
CORS_ORIGIN=http://localhost:5173
EOF

docker run --rm \
  --name voice-lambda-api \
  --env-file /tmp/voice-lambda-api.env \
  --add-host=host.docker.internal:host-gateway \
  -p 9000:8080 \
  voice-lambda-api:local
```

Quick checks:

```bash
curl -s \
  -X POST "http://127.0.0.1:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d '{"rawPath":"/api/models","requestContext":{"http":{"method":"GET","path":"/api/models"}}}'

curl -s \
  -X POST "http://127.0.0.1:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d '{"rawPath":"/api/train/current","requestContext":{"http":{"method":"GET","path":"/api/train/current"}}}'
```

## Troubleshooting

`COPY docker/vendor/GPT-SoVITS.zip` fails:

- Download the prepared bundle into `docker/vendor/GPT-SoVITS.zip`
- Run the Docker build from the repo root, not from `gpu-worker/` or `gpu-inference-worker/`

`docker run --gpus all` fails:

- Confirm the EC2 instance has a GPU: `nvidia-smi`
- Install NVIDIA Container Toolkit on the host
- Restart Docker after installing the toolkit

`torch.cuda.is_available()` returns `False`:

- Confirm the container was run with `--gpus all`
- Confirm the host driver is new enough for the CUDA and PyTorch stack
- Confirm `nvidia-smi` works both on the host and inside the container

Training and inference containers cannot both start on one host:

- You probably published both to the same host port
- Keep the internal container port at `3001`
- Publish different host ports, for example `3001:3001` for training and `3003:3001` for inference

Lambda still sends inference traffic to training:

- Confirm `INFERENCE_WORKER_URL` is set in Lambda
- Confirm the Lambda config update completed successfully
- Remember that Lambda intentionally falls back to `GPU_WORKER_URL` until `INFERENCE_WORKER_URL` exists

Browser inference SSE fails after the split:

- Confirm `/inference/progress/*` routes to the inference worker at the public layer
- Confirm `VITE_GPU_WORKER_URL` points to a shared worker-facing public domain, not directly to the training-only worker

`/inference/start` times out:

- Check inference container logs: `docker logs voice-gpu-inference-worker`
- Run GPT-SoVITS directly inside the inference container:

```bash
docker exec -it voice-gpu-inference-worker bash
cd /opt/gpt-sovits
. venv/bin/activate
python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```

The split deploy works but training still hurts live inference latency:

- The containers are probably sharing the same GPU host
- Move training and inference onto separate GPU capacity if you need true isolation
