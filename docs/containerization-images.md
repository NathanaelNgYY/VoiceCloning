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

## GPU EC2 Quick Start

Use this section when you are on the GPU EC2 through SSM and starting from a prompt like:

```text
ubuntu@ip-10-0-5-77:~$
```

### 1. Go To The Repo

```bash
cd ~/VoiceCloning
pwd
```

Expected:

```text
/home/ubuntu/VoiceCloning
```

Path reminder:

```text
~/VoiceCloning
= /home/ubuntu/VoiceCloning
= the app repo where Docker builds run

/opt/gpt-sovits
= the existing host install of GPT-SoVITS
= useful as a reference, but not the Docker build context

~/VoiceCloning/docker/vendor/GPT-SoVITS.zip
= the build input copied into the GPU image
```

### 2. Install Docker If Missing

Check:

```bash
docker --version
```

If you see `Command 'docker' not found`, install Docker:

```bash
sudo apt update
sudo apt install -y docker.io
sudo systemctl enable --now docker
sudo systemctl status docker --no-pager
```

Allow the `ubuntu` user to run Docker:

```bash
sudo usermod -aG docker ubuntu
```

Apply the group change. Either reconnect to SSM, or run:

```bash
newgrp docker
```

Then verify:

```bash
docker --version
docker ps
```

If `docker ps` still says permission denied, reconnect to SSM and try again. You can also temporarily prefix Docker commands with `sudo`, but reconnecting is cleaner.

### 3. Confirm The Host GPU Works

```bash
nvidia-smi
```

Expected: a table showing the NVIDIA GPU. If `nvidia-smi` fails on the host, fix the GPU driver before working on containers.

### 4. Install NVIDIA Container Toolkit

Docker alone is not enough for `--gpus all`. Install the NVIDIA Container Toolkit:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Verify Docker can see the GPU:

```bash
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

Expected: a normal `nvidia-smi` table from inside the test container.

### 5. Download GPT-SoVITS Zip From S3

Do not manually zip `/opt/gpt-sovits` unless the S3 bundle is unavailable. Use the prepared project bundle:

```bash
cd ~/VoiceCloning
mkdir -p docker/vendor

aws s3 cp \
  s3://interns2026-small-projects-bucket-shared/echolect/GPT-SoVITS.zip \
  docker/vendor/GPT-SoVITS.zip \
  --region ap-southeast-1
```

Check:

```bash
ls -lh docker/vendor/GPT-SoVITS.zip
```

Expected: a large file, currently around `12G`.

If the file is missing, do not continue to `docker build`; the GPU Dockerfile needs this zip.

### 6. Build Inside `tmux`

The GPU image build can take a long time because it unzips GPT-SoVITS and installs Python dependencies. Use `tmux` so SSM disconnects do not kill the build:

```bash
sudo apt install -y tmux
tmux new -s containerize
```

Inside tmux:

```bash
cd ~/VoiceCloning
docker build \
  -f gpu-worker/Dockerfile \
  -t voice-gpu-worker:local \
  .
```

Detach without stopping the build:

```text
Ctrl+B, then D
```

Reconnect later:

```bash
tmux attach -t containerize
```

After the build completes:

```bash
docker images | grep voice-gpu-worker
```

### 6A. Keep Work Running If SSM Signs Out

SSM browser sessions can disconnect. A normal foreground command usually stops when its terminal is closed. Use one of these options for long commands.

Recommended option: `tmux`.

```bash
sudo apt install -y tmux
tmux new -s containerize
```

Run long commands inside tmux, for example:

```bash
cd ~/VoiceCloning
docker build -f gpu-worker/Dockerfile -t voice-gpu-worker:local .
```

Detach while keeping it running:

```text
Ctrl+B, then D
```

List tmux sessions after reconnecting:

```bash
tmux ls
```

Reattach:

```bash
tmux attach -t containerize
```

Stop a tmux session only when you are sure you do not need it:

```bash
tmux kill-session -t containerize
```

Fallback option: `nohup`.

Use this if you only need a command to keep running and you are okay reading logs from a file:

```bash
cd ~/VoiceCloning
nohup docker build -f gpu-worker/Dockerfile -t voice-gpu-worker:local . \
  > /tmp/voice-gpu-worker-build.log 2>&1 &
```

Watch the log:

```bash
tail -f /tmp/voice-gpu-worker-build.log
```

Check whether the command is still running:

```bash
pgrep -af "docker build.*voice-gpu-worker"
```

### 6B. Check Whether Work Is Still Running

After reconnecting to SSM, use these checks.

Check active Docker builds:

```bash
pgrep -af "docker build"
ps aux | grep '[d]ocker build'
```

Check Docker daemon activity:

```bash
docker ps
docker ps -a
```

Check whether the image was created:

```bash
docker images | grep voice-gpu-worker
docker images | grep 'voice-'
```

Check disk usage while building:

```bash
df -h /
docker system df
```

Check a running GPU worker container:

```bash
docker ps --filter name=voice-gpu-worker
docker logs --tail 100 voice-gpu-worker
curl http://127.0.0.1:13001/healthz
```

Follow logs live:

```bash
docker logs -f voice-gpu-worker
```

Check whether old manual `zip` work is still running:

```bash
ps aux | grep '[z]ip'
```

Check whether the S3 GPT-SoVITS zip exists:

```bash
ls -lh /home/ubuntu/VoiceCloning/docker/vendor/GPT-SoVITS.zip
```

### 6C. What Happens If EC2 Stops Or Terminates

There is a big difference between **SSM sign out**, **EC2 stop**, and **EC2 terminate**.

If SSM signs out:

- `tmux` commands continue.
- running Docker containers continue.
- foreground commands outside tmux may stop.

If EC2 is stopped and later started:

- running processes stop.
- Docker containers stop.
- files on the root EBS volume usually remain, including:
  - `~/VoiceCloning`
  - `docker/vendor/GPT-SoVITS.zip`
  - built local Docker images
- after start, check containers with:

```bash
docker ps -a
docker images | grep 'voice-'
```

If EC2 is terminated:

- the instance is deleted.
- files are lost unless the EBS volume is preserved separately.
- local Docker images are lost.
- pushed ECR images remain safe.
- S3 files remain safe.

For work you do not want to lose, push images to ECR after a successful build:

```bash
AWS_REGION=ap-northeast-2
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker tag voice-gpu-worker:local "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-worker:latest"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/voice-gpu-worker:latest"
```

To make a test container restart automatically after Docker or EC2 restarts, run it with a restart policy:

```bash
docker run -d \
  --name voice-gpu-worker \
  --restart unless-stopped \
  --gpus all \
  --env-file /tmp/voice-gpu-worker.env \
  -p 13001:3001 \
  voice-gpu-worker:local
```

Then inspect it later:

```bash
docker ps
docker logs --tail 100 voice-gpu-worker
curl http://127.0.0.1:13001/healthz
```

Stop and remove it when finished:

```bash
docker stop voice-gpu-worker
docker rm voice-gpu-worker
```

### 7. Run A Safe GPU Worker Smoke Test

If the existing host `gpu-worker.service` is still using port `3001`, do not fight it. Map the container to host port `13001` for testing:

```bash
docker run --rm \
  --name voice-gpu-worker \
  --gpus all \
  -e NODE_ENV=production \
  -e WORKER_HOST=0.0.0.0 \
  -e WORKER_PORT=3001 \
  -e GPT_SOVITS_ROOT=/opt/gpt-sovits \
  -e PYTHON_EXEC=/opt/gpt-sovits/venv/bin/python \
  -e INFERENCE_HOST=127.0.0.1 \
  -e INFERENCE_PORT=9880 \
  -e LOCAL_TEMP_ROOT=/opt/gpt-sovits/worker_temp \
  -e S3_BUCKET=interns2026-small-projects-bucket-shared \
  -e S3_REGION=ap-southeast-1 \
  -e S3_PREFIX=echolect/ \
  -e CORS_ORIGIN='*' \
  -p 13001:3001 \
  voice-gpu-worker:local
```

In another SSM tab:

```bash
curl http://127.0.0.1:13001/healthz

docker exec voice-gpu-worker nvidia-smi

docker exec voice-gpu-worker \
  /opt/gpt-sovits/venv/bin/python -c "import torch; print(torch.__version__); print(torch.cuda.is_available())"

curl http://127.0.0.1:13001/models
curl -X POST http://127.0.0.1:13001/inference/start
curl http://127.0.0.1:13001/inference/status
```

If you are ready to replace the host service and use real port `3001`, stop the host service first:

```bash
sudo systemctl stop gpu-worker
docker run --rm \
  --name voice-gpu-worker \
  --gpus all \
  --env-file /tmp/voice-gpu-worker.env \
  -p 3001:3001 \
  voice-gpu-worker:local
```

### 8. Build The Other Two Images

These do not need GPU:

```bash
cd ~/VoiceCloning
docker build -f lambda/Dockerfile -t voice-lambda-api:local .
docker build -f live-gateway/Dockerfile -t voice-live-gateway:local .
```

Check:

```bash
docker images | grep 'voice-'
```

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

Expected today:

```text
-rw-rw-r-- 1 ubuntu ubuntu 12G ... docker/vendor/GPT-SoVITS.zip
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

If Docker is not installed, first follow **GPU EC2 Quick Start -> Install Docker If Missing**.

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

If port `3001` is already used by the existing host service, either stop it:

```bash
sudo systemctl stop gpu-worker
```

or keep the host service running and map the container to a temporary test port:

```bash
docker run --rm \
  --name voice-gpu-worker \
  --gpus all \
  --env-file /tmp/voice-gpu-worker.env \
  -p 13001:3001 \
  voice-gpu-worker:local
```

When using the temporary port, call the worker on `13001` from the host:

```bash
curl http://127.0.0.1:13001/healthz
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
- Confirm with `ls -lh ~/VoiceCloning/docker/vendor/GPT-SoVITS.zip`.

`docker: command not found`:

- Install Docker with `sudo apt install -y docker.io`.
- Start Docker with `sudo systemctl enable --now docker`.
- Add the user with `sudo usermod -aG docker ubuntu`, then reconnect to SSM or run `newgrp docker`.

Docker permission denied:

- Reconnect to SSM after `sudo usermod -aG docker ubuntu`.
- Or temporarily run Docker commands with `sudo docker ...`.

`docker run --gpus all` fails:

- Confirm the EC2 instance has a GPU: `nvidia-smi`.
- Install NVIDIA Container Toolkit on the host.
- Restart Docker after installing the toolkit.
- Verify with `docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi`.

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

Temporary zip file appears while zipping manually:

- Files such as `ziU404ak` are temporary files created by `zip`.
- If the command finishes cleanly, the final file should be `GPT-SoVITS.zip`.
- If only the temporary file remains, the zip was interrupted. Prefer downloading the prepared S3 bundle instead:

```bash
cd ~/VoiceCloning
mkdir -p docker/vendor
aws s3 cp \
  s3://interns2026-small-projects-bucket-shared/echolect/GPT-SoVITS.zip \
  docker/vendor/GPT-SoVITS.zip \
  --region ap-southeast-1
```

Unsure which folder you are in:

```bash
pwd
```

Use absolute paths when checking the zip:

```bash
ls -lh /home/ubuntu/VoiceCloning/docker/vendor/GPT-SoVITS.zip
```

Do not check `docker/vendor/GPT-SoVITS.zip` from `/opt/gpt-sovits`; that would mean `/opt/gpt-sovits/docker/vendor/GPT-SoVITS.zip`, which is the wrong folder.
