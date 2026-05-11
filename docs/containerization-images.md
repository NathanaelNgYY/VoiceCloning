# VoiceCloning Container Images

Last updated: 2026-05-11

This guide defines the three container images for the current split architecture. It does not use Docker Compose.

## Image Summary

| Image | Dockerfile | Purpose | Runtime |
| --- | --- | --- | --- |
| `voice-gpu-worker` | `gpu-worker/Dockerfile` | GPU worker plus GPT-SoVITS runtime. Exposes training and inference HTTP routes. | GPU EC2, ECS on GPU EC2 capacity, or future SageMaker adapter base |
| `voice-lambda-api` | `lambda/Dockerfile` | Lambda Function URL backend packaged as a Lambda container image. | AWS Lambda container image |
| `voice-live-gateway` | `live-gateway/Dockerfile` | WebSocket and OpenAI Realtime gateway. | EC2, ECS/Fargate, or any normal container host |

The frontend is intentionally not one of these images. The deployed frontend should stay as static files on S3 plus CloudFront unless a separate local-only Nginx image is needed later.

## Important Boundary

`voice-gpu-worker` contains both:

- `gpu-worker/`, the Node.js orchestration service
- GPT-SoVITS, the Python/CUDA model runtime

The same image can run the current worker API for both training and inference:

- `POST /train`
- `GET /train/current`
- `GET /models`
- `POST /models/download`
- `POST /inference/weights/gpt`
- `POST /inference/weights/sovits`
- `POST /inference`
- `POST /inference/generate`
- `GET /inference/progress/:sessionId`
- `POST /inference/tts`
- `GET /healthz`

Do not bake user-trained checkpoints, uploaded samples, generated WAV files, API keys, or environment-specific settings into the image. Those stay in S3 and environment variables.

## Prerequisites

Install these on the machine that builds/runs the containers:

- Docker
- AWS CLI, if pulling GPT-SoVITS from S3 or pushing to ECR
- NVIDIA driver and NVIDIA Container Toolkit for the GPU image
- Access to the project S3 bucket if downloading the prepared GPT-SoVITS bundle

For real GPU testing, use the GPU EC2 instance through SSM. A normal laptop can build and run `voice-lambda-api` and `voice-live-gateway`, but it usually cannot validate GPT-SoVITS CUDA training/inference.

## Prepare GPT-SoVITS For The GPU Image

The repo does not store GPT-SoVITS directly. The GPU image expects the prepared bundle here before build:

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

The Docker build unzips this bundle into `/opt/gpt-sovits`, creates `/opt/gpt-sovits/venv`, installs Python dependencies, and configures:

```env
GPT_SOVITS_ROOT=/opt/gpt-sovits
PYTHON_EXEC=/opt/gpt-sovits/venv/bin/python
INFERENCE_HOST=127.0.0.1
INFERENCE_PORT=9880
WORKER_HOST=0.0.0.0
WORKER_PORT=3001
```

## Build Images

Run these from the repository root.

Build the GPU worker image:

```bash
docker build \
  -f gpu-worker/Dockerfile \
  -t voice-gpu-worker:local \
  .
```

Build the Lambda API image:

```bash
docker build \
  -f lambda/Dockerfile \
  -t voice-lambda-api:local \
  .
```

Build the live gateway image:

```bash
docker build \
  -f live-gateway/Dockerfile \
  -t voice-live-gateway:local \
  .
```

Do not use `docker build .` at the repo root. The root Dockerfile now exits with instructions so the old deleted `server/` layout is not built by accident.

## Run And Test `voice-gpu-worker`

Create a runtime env file on the GPU EC2. Use real values for the CloudFront domains if testing browser traffic.

```bash
cat > /tmp/voice-gpu-worker.env <<'EOF'
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

Run the container:

```bash
docker run --rm \
  --name voice-gpu-worker \
  --gpus all \
  --env-file /tmp/voice-gpu-worker.env \
  -p 3001:3001 \
  voice-gpu-worker:local
```

In another SSM terminal, verify GPU access:

```bash
docker exec voice-gpu-worker nvidia-smi
```

Verify PyTorch sees CUDA:

```bash
docker exec voice-gpu-worker \
  /opt/gpt-sovits/venv/bin/python -c "import torch; print(torch.__version__); print(torch.cuda.is_available())"
```

Verify worker health:

```bash
curl http://127.0.0.1:3001/healthz
```

Verify model discovery:

```bash
curl http://127.0.0.1:3001/models
```

Start GPT-SoVITS through the worker:

```bash
curl -X POST http://127.0.0.1:3001/inference/start
curl http://127.0.0.1:3001/inference/status
```

The container image supports both training and inference through the current GPU worker API. For production, avoid running heavy training and live inference on the same running container instance at the same time, because both compete for the same GPU memory and compute.

## Run And Test `voice-live-gateway`

Create a runtime env file:

```bash
cat > /tmp/voice-live-gateway.env <<'EOF'
NODE_ENV=production
PORT=3002
CORS_ORIGIN=https://TRAINING_CLOUDFRONT_DOMAIN,https://LIVE_FAST_CLOUDFRONT_DOMAIN

OPENAI_API_KEY=REPLACE_WITH_BACKEND_ONLY_OPENAI_KEY
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VAD=semantic_vad
OPENAI_REALTIME_SYSTEM_PROMPT=You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.
EOF
```

Run it:

```bash
docker run --rm \
  --name voice-live-gateway \
  --env-file /tmp/voice-live-gateway.env \
  -p 3002:3002 \
  voice-live-gateway:local
```

Health check:

```bash
curl http://127.0.0.1:3002/healthz
```

Live chat itself must be tested with a WebSocket client or through the browser path:

```text
/api/live/chat/realtime
```

In production, this service should be behind an ALB or CloudFront behavior that supports WebSocket upgrade headers.

## Run And Test `voice-lambda-api` Locally

Create a runtime env file with the same variables used by the current Lambda Function URL deployment:

```bash
cat > /tmp/voice-lambda-api.env <<'EOF'
S3_BUCKET=interns2026-small-projects-bucket-shared
S3_REGION=ap-southeast-1
S3_PREFIX=echolect/
GPU_WORKER_URL=http://host.docker.internal:3001
GPU_WORKER_PUBLIC_URL=http://localhost:3001
MODEL_SOURCE=s3
ARTIFACT_SOURCE=s3
CORS_ORIGIN=http://localhost:5173
EOF
```

On Linux EC2, `host.docker.internal` may not resolve by default. If Lambda and the GPU worker containers are on the same host without Docker Compose, either:

- run the Lambda container with `--add-host=host.docker.internal:host-gateway`, or
- set `GPU_WORKER_URL` to the host private IP or ALB URL.

Run the Lambda image locally:

```bash
docker run --rm \
  --name voice-lambda-api \
  --env-file /tmp/voice-lambda-api.env \
  --add-host=host.docker.internal:host-gateway \
  -p 9000:8080 \
  voice-lambda-api:local
```

Invoke the local Lambda runtime:

```bash
curl -s \
  -X POST "http://127.0.0.1:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d '{"rawPath":"/api/config","requestContext":{"http":{"method":"GET","path":"/api/config"}}}'
```

Expected response body:

```json
{"statusCode":200,"body":"{\"storageMode\":\"s3\",\"inferenceMode\":\"remote\"}"}
```

## Push Images To ECR

Set variables:

```bash
AWS_REGION=ap-northeast-2
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

Create repositories once:

```bash
aws ecr create-repository --repository-name voice-gpu-worker --region "$AWS_REGION"
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
docker tag voice-lambda-api:local "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-lambda-api:latest"
docker tag voice-live-gateway:local "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-live-gateway:latest"

docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-worker:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-lambda-api:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-live-gateway:latest"
```

## Deploy Target Recommendations

### GPU Worker

Initial target:

```text
GPU EC2 running Docker
```

Use this first because it is closest to the current deployment and easiest to debug through SSM.

Future target:

```text
SageMaker training jobs for training
SageMaker endpoint or async inference for TTS inference
```

The current image is the right base for that, but SageMaker-native hosting still needs an adapter that listens on port `8080` and implements `/ping` and `/invocations`. SageMaker training jobs also expect the training entrypoint to read from `/opt/ml/input` and write outputs to `/opt/ml/model`.

AWS references:

- SageMaker custom inference containers: https://docs.aws.amazon.com/sagemaker/latest/dg/your-algorithms-inference-code.html
- SageMaker custom training containers: https://docs.aws.amazon.com/sagemaker/latest/dg/your-algorithms-training-algo-dockerfile.html

### Lambda API

Target:

```text
AWS Lambda container image
```

After pushing the image to ECR, update the function code:

```bash
aws lambda update-function-code \
  --region ap-northeast-2 \
  --function-name Liu_Teng_Yu_Intern2026-Voice_Cloning_Project \
  --image-uri "$ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/voice-lambda-api:latest"
```

AWS Lambda Node.js container image reference:

```text
https://docs.aws.amazon.com/lambda/latest/dg/nodejs-image.html
```

### Live Gateway

Recommended target:

```text
ECS/Fargate or EC2 container
```

Do not deploy `live-gateway` to SageMaker. It is a WebSocket and OpenAI Realtime service, not a model-serving container.

Required runtime env:

```env
NODE_ENV=production
PORT=3002
CORS_ORIGIN=https://TRAINING_CLOUDFRONT_DOMAIN,https://LIVE_FAST_CLOUDFRONT_DOMAIN
OPENAI_API_KEY=REPLACE_WITH_BACKEND_ONLY_OPENAI_KEY
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VAD=semantic_vad
OPENAI_REALTIME_SYSTEM_PROMPT=You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.
```

## Troubleshooting

`COPY docker/vendor/GPT-SoVITS.zip` fails:

- Download the prepared bundle into `docker/vendor/GPT-SoVITS.zip`.
- Run the Docker build from the repo root, not from `gpu-worker/`.

`docker run --gpus all` fails:

- Confirm the EC2 instance has a GPU: `nvidia-smi`.
- Install NVIDIA Container Toolkit on the host.
- Restart Docker after installing the toolkit.

`torch.cuda.is_available()` returns `False`:

- Confirm the container was run with `--gpus all`.
- Confirm the host driver is new enough for the CUDA/PyTorch stack.
- Confirm `nvidia-smi` works both on the host and inside the container.

`/inference/start` times out:

- Check container logs: `docker logs voice-gpu-worker`.
- Run GPT-SoVITS directly inside the container:

```bash
docker exec -it voice-gpu-worker bash
cd /opt/gpt-sovits
. venv/bin/activate
python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```

Lambda container cannot reach GPU worker:

- On Linux, add `--add-host=host.docker.internal:host-gateway`, or use the host private IP.
- In AWS, use the GPU ALB URL or future internal ALB URL for `GPU_WORKER_URL`.

Live WebSocket does not connect:

- Confirm `curl http://127.0.0.1:3002/healthz` works.
- Confirm the ALB/CloudFront behavior forwards WebSocket upgrade headers.
- Confirm `/api/live/chat/realtime` routes to `voice-live-gateway`, not Lambda.
