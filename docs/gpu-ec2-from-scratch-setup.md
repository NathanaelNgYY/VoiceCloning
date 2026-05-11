# GPU EC2 Setup From Scratch

Last updated: 2026-05-09

This document covers only the GPU EC2 setup: creating/preparing the instance, installing GPT-SoVITS v2, downloading the project GPT-SoVITS bundle from S3, pulling the VoiceCloning web application from GitHub, and running the EC2 services with `systemd`.

The expected final EC2 structure is:

```text
/home/ubuntu/VoiceCloning
/home/ubuntu/VoiceCloning/gpu-worker
/home/ubuntu/VoiceCloning/live-gateway
/opt/gpt-sovits
```

`/home/ubuntu/VoiceCloning` is the application repository. `/opt/gpt-sovits` is the GPT-SoVITS AI runtime used by `gpu-worker`.

## 1. AWS Side Setup

Create or confirm the EC2 instance uses:

- Region: current GPU deployment is in Seoul, `ap-northeast-2`.
- Instance type: NVIDIA GPU instance, currently a G6 family instance.
- AMI: Ubuntu 24.04.
- Storage: 50 GB EBS for the EC2 instance. Project files, uploaded audio, trained model artifacts, and generated audio are stored in S3, so the EC2 disk is mainly for the checked-out app, GPT-SoVITS runtime, Python environment, logs, and temporary work files.
- IAM instance profile:
  - `AmazonSSMManagedInstanceCore` for AWS Systems Manager Session Manager access.
  - S3 permissions for the project bucket/prefix.
  - Optional SES/SMTP-related permissions only if email notification is done through AWS SES. Current `gpu-worker` email code uses SMTP-style environment variables.

Example S3 policy for the EC2 instance role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::interns2026-small-projects-bucket-shared",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["echolect/*", "echolect"]
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::interns2026-small-projects-bucket-shared/echolect/*"
    }
  ]
}
```

Security group target state:

- No public inbound SSH is required if Session Manager is used.
- ALB to EC2: allow TCP `3001` for `gpu-worker`.
- ALB to EC2: allow TCP `3002` for `live-gateway`.
- Do not expose `9880` publicly. GPT-SoVITS `api_v2.py` should listen on `127.0.0.1:9880` only.
- Outbound HTTPS must be allowed so the instance can reach S3, GitHub, npm, Python package indexes, OpenAI, and AWS services.

ALB setup:

- `gpu-worker` target group: instance target, port `3001`, health path `/healthz`.
- `live-gateway` target group: instance target, port `3002`, health path `/healthz`.
- ALB rule: `/api/live/chat/realtime` forwards to `live-gateway:3002`.
- ALB default action forwards to `gpu-worker:3001`.

## 2. Connect To The Instance

Open the AWS EC2 console, select the GPU instance, choose **Connect**, then **Session Manager**. The instance must show as connected/online.

Inside the browser terminal:

```bash
sudo su - ubuntu
cd ~
```

Confirm the operating system:

```bash
lsb_release -a || cat /etc/os-release
uname -a
```

## 3. Base OS Packages

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y \
  build-essential \
  ca-certificates \
  cmake \
  curl \
  ffmpeg \
  git \
  gnupg \
  htop \
  libsox-dev \
  lsb-release \
  pkg-config \
  rsync \
  software-properties-common \
  tmux \
  unzip \
  wget
```

Install AWS CLI if it is not already present:

```bash
if ! command -v aws >/dev/null 2>&1; then
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
  unzip -q /tmp/awscliv2.zip -d /tmp
  sudo /tmp/aws/install
fi

aws --version
aws sts get-caller-identity
```

## 4. GPU Driver Check

If using a Deep Learning AMI, the driver may already be installed:

```bash
nvidia-smi
```

If `nvidia-smi` is missing or fails on a plain Ubuntu AMI, install NVIDIA drivers and reboot:

```bash
sudo apt update
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers install --gpgpu
sudo reboot
```

Reconnect through SSM after reboot:

```bash
sudo su - ubuntu
nvidia-smi
```

AWS documents that NVIDIA GPU EC2 instance families require an NVIDIA driver, and for G6/L4 instances the minimum public driver version is 525.0 or later. If the Ubuntu automatic driver selection installs a newer compatible driver, that is fine.

## 5. Install Node.js 20

The application services are Node.js services. Use Node.js 20 to match the Lambda runtime family and avoid old Node issues.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

node -v
npm -v
```

## 6. Install Python For GPT-SoVITS

This EC2 uses a normal Python virtual environment, not conda. GPT-SoVITS v2 dependencies include packages that require Python below 3.11, so use Python 3.9 to match the official v2 setup. Ubuntu 24.04 ships with a newer default Python, so install Python 3.9 separately.

```bash
if ! command -v python3.9 >/dev/null 2>&1; then
  sudo add-apt-repository -y ppa:deadsnakes/ppa
  sudo apt update
  sudo apt install -y python3.9 python3.9-venv python3.9-dev
fi

python3.9 --version
```

## 7. Install GPT-SoVITS Into `/opt/gpt-sovits`

Project standard: download the prepared GPT-SoVITS zip from S3, unzip it, and place it under `/opt/gpt-sovits`.

```bash
sudo mkdir -p /opt/gpt-sovits
sudo chown -R ubuntu:ubuntu /opt/gpt-sovits

rm -rf /tmp/gpt-sovits-unpack /tmp/GPT-SoVITS.zip
mkdir -p /tmp/gpt-sovits-unpack

aws s3 cp \
  s3://interns2026-small-projects-bucket-shared/echolect/GPT-SoVITS.zip \
  /tmp/GPT-SoVITS.zip \
  --region ap-southeast-1

unzip -q /tmp/GPT-SoVITS.zip -d /tmp/gpt-sovits-unpack
ls /tmp/gpt-sovits-unpack
```

The zip may either contain a top-level `GPT-SoVITS/` folder or the project files directly. Copy it safely:

```bash
if [ -d /tmp/gpt-sovits-unpack/GPT-SoVITS ]; then
  rsync -a /tmp/gpt-sovits-unpack/GPT-SoVITS/ /opt/gpt-sovits/
else
  rsync -a /tmp/gpt-sovits-unpack/ /opt/gpt-sovits/
fi

cd /opt/gpt-sovits
ls
```

Expected important files/folders:

```text
api_v2.py
GPT_SoVITS/
tools/
requirements.txt
```

Optional official-source fallback, if the S3 zip is unavailable:

```bash
sudo rm -rf /opt/gpt-sovits
git clone --branch 20240821v2 https://github.com/RVC-Boss/GPT-SoVITS.git /opt/gpt-sovits
sudo chown -R ubuntu:ubuntu /opt/gpt-sovits
cd /opt/gpt-sovits
```

The S3 zip is still preferred for this project because it preserves the prepared runtime/models we uploaded to S3.

## 8. Install GPT-SoVITS Python Dependencies

Create and activate the Python virtual environment inside `/opt/gpt-sovits`:

```bash
cd /opt/gpt-sovits
python3.9 -m venv venv
. venv/bin/activate
python --version
```

Install PyTorch and the GPT-SoVITS dependencies:

```bash
python -m pip install --upgrade pip setuptools wheel
python -m pip install \
  torch==2.1.1 \
  torchvision==0.16.1 \
  torchaudio==2.1.1 \
  --index-url https://download.pytorch.org/whl/cu118
python -m pip install -r requirements.txt
python -m pip install "fastapi<0.112.2" "uvicorn[standard]" attrdict
```

Confirm that `gpu-worker` can use the same Python interpreter:

```bash
/opt/gpt-sovits/venv/bin/python --version
```

Verify Python can import key packages:

```bash
python - <<'PY'
import torch
import librosa
import fastapi
print("torch", torch.__version__)
print("cuda", torch.cuda.is_available())
print("gpu", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none")
print("librosa", librosa.__version__)
PY
```

## 9. Confirm GPT-SoVITS Models

For v2, the project expects pretrained models in:

```text
/opt/gpt-sovits/GPT_SoVITS/pretrained_models/gsv-v2final-pretrained
/opt/gpt-sovits/GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large
/opt/gpt-sovits/GPT_SoVITS/pretrained_models/chinese-hubert-base
/opt/gpt-sovits/GPT_SoVITS/text/G2PWModel
```

Check:

```bash
cd /opt/gpt-sovits

ls GPT_SoVITS/pretrained_models/gsv-v2final-pretrained
ls GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large
ls GPT_SoVITS/pretrained_models/chinese-hubert-base
ls GPT_SoVITS/text/G2PWModel
```

The `gpu-worker` also looks for trained model outputs here:

```text
/opt/gpt-sovits/GPT_weights_v2
/opt/gpt-sovits/SoVITS_weights_v2
```

Create them if missing:

```bash
mkdir -p /opt/gpt-sovits/GPT_weights_v2
mkdir -p /opt/gpt-sovits/SoVITS_weights_v2
```

If trained weights are stored in S3 under the project `models/` prefix, inspect the structure first:

```bash
aws s3 ls s3://interns2026-small-projects-bucket-shared/echolect/models/ --recursive --region ap-southeast-1
```

Then copy `.ckpt` files into `/opt/gpt-sovits/GPT_weights_v2` and `.pth` files into `/opt/gpt-sovits/SoVITS_weights_v2`.

## 10. Smoke Test GPT-SoVITS API

Run this manually once before creating services:

```bash
cd /opt/gpt-sovits
. venv/bin/activate
python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```

In another SSM session:

```bash
curl -I http://127.0.0.1:9880/docs
```

Stop the manual `api_v2.py` process with `Ctrl+C` after the check.

Current `gpu-worker` can start/manage `api_v2.py` itself through `/inference/start`, so a separate GPT-SoVITS `systemd` service is optional. Do not expose port `9880` externally.

## 11. Pull The VoiceCloning Application

```bash
cd ~

if [ ! -d "$HOME/VoiceCloning/.git" ]; then
  git clone https://github.com/NathanaelNgYY/VoiceCloning.git "$HOME/VoiceCloning"
fi

cd "$HOME/VoiceCloning"
git fetch origin
git checkout deployment-split-change
git pull --ff-only origin deployment-split-change
```

Install service dependencies:

```bash
cd ~/VoiceCloning/gpu-worker
npm ci --omit=dev

cd ~/VoiceCloning/live-gateway
npm ci --omit=dev
```

## 12. Create Environment Files

Create `gpu-worker/.env`:

```bash
cat > ~/VoiceCloning/gpu-worker/.env <<'EOF'
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

# Optional email notification settings, if enabled in the app:
# EMAIL_HOST=smtp.gmail.com
# EMAIL_PORT=587
# EMAIL_USER=
# EMAIL_PASS=
# EMAIL_FROM=
EOF

chmod 600 ~/VoiceCloning/gpu-worker/.env
```

Create `live-gateway/.env`:

```bash
cat > ~/VoiceCloning/live-gateway/.env <<'EOF'
NODE_ENV=production
PORT=3002
CORS_ORIGIN=https://TRAINING_CLOUDFRONT_DOMAIN,https://LIVE_FAST_CLOUDFRONT_DOMAIN

OPENAI_API_KEY=REPLACE_WITH_BACKEND_ONLY_OPENAI_KEY
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VAD=semantic_vad
OPENAI_REALTIME_SYSTEM_PROMPT=You are a casual, helpful assistant. Keep replies concise and conversational. Always respond only in English.
EOF

chmod 600 ~/VoiceCloning/live-gateway/.env
```

Replace the CloudFront domains and OpenAI key before starting the services.

## 13. Create `systemd` Services

Create `gpu-worker.service`:

```bash
sudo tee /etc/systemd/system/gpu-worker.service >/dev/null <<'EOF'
[Unit]
Description=Voice Cloning GPU Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/VoiceCloning/gpu-worker
EnvironmentFile=/home/ubuntu/VoiceCloning/gpu-worker/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF
```

Create `live-gateway.service`:

```bash
sudo tee /etc/systemd/system/live-gateway.service >/dev/null <<'EOF'
[Unit]
Description=Voice Cloning Live Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/VoiceCloning/live-gateway
EnvironmentFile=/home/ubuntu/VoiceCloning/live-gateway/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gpu-worker
sudo systemctl enable --now live-gateway
```

Check status:

```bash
sudo systemctl status gpu-worker --no-pager
sudo systemctl status live-gateway --no-pager
```

View logs:

```bash
journalctl -u gpu-worker -f
journalctl -u live-gateway -f
```

## 14. Local EC2 Validation

Run from the EC2 instance:

```bash
curl http://127.0.0.1:3001/healthz
curl http://127.0.0.1:3002/healthz
```

Check that `gpu-worker` can see GPT-SoVITS:

```bash
curl http://127.0.0.1:3001/models
```

Start the GPT-SoVITS inference API through the worker:

```bash
curl -X POST http://127.0.0.1:3001/inference/start
curl http://127.0.0.1:3001/inference/status
curl -I http://127.0.0.1:9880/docs
```

If `/inference/start` fails, inspect:

```bash
journalctl -u gpu-worker -n 200 --no-pager
/opt/gpt-sovits/venv/bin/python - <<'PY'
import torch
print(torch.__version__)
print(torch.cuda.is_available())
PY
```

## 15. ALB Validation

Replace `ALB_DNS` with the GPU ALB DNS name:

```bash
ALB_DNS=voice-gpu-alb-815777974.ap-northeast-2.elb.amazonaws.com

curl "http://$ALB_DNS/healthz"
curl "http://$ALB_DNS/models"
```

For the live WebSocket route, use a WebSocket client from your local machine or a temporary EC2 test tool. The ALB rule should send `/api/live/chat/realtime` to port `3002`.

## 16. Updating The EC2 Later

When code changes are pushed:

```bash
sudo su - ubuntu
cd ~/VoiceCloning
git fetch origin
git checkout deployment-split-change
git pull --ff-only origin deployment-split-change

cd ~/VoiceCloning/gpu-worker
npm ci --omit=dev

cd ~/VoiceCloning/live-gateway
npm ci --omit=dev

sudo systemctl restart gpu-worker
sudo systemctl restart live-gateway

sudo systemctl status gpu-worker --no-pager
sudo systemctl status live-gateway --no-pager
```

If only `live-gateway/` changed, restart only `live-gateway`. If only `gpu-worker/` changed, restart only `gpu-worker`.

## 17. Troubleshooting Checklist

SSM does not connect:

```bash
# Check in AWS console:
# - Instance IAM role has AmazonSSMManagedInstanceCore.
# - Instance has outbound HTTPS access.
# - SSM Agent is installed/running on the AMI.
```

GPU not detected:

```bash
nvidia-smi
sudo reboot
```

Python environment wrong:

```bash
/opt/gpt-sovits/venv/bin/python --version
/opt/gpt-sovits/venv/bin/python -c "import torch; print(torch.cuda.is_available())"
```

S3 access fails:

```bash
aws sts get-caller-identity
aws s3 ls s3://interns2026-small-projects-bucket-shared/echolect/ --region ap-southeast-1
```

`gpu-worker` cannot start GPT-SoVITS:

```bash
journalctl -u gpu-worker -n 200 --no-pager
cd /opt/gpt-sovits
. venv/bin/activate
python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```

ALB target unhealthy:

```bash
curl http://127.0.0.1:3001/healthz
curl http://127.0.0.1:3002/healthz
sudo systemctl status gpu-worker --no-pager
sudo systemctl status live-gateway --no-pager
```

Live WebSocket returns HTTP 200 instead of upgrading:

- CloudFront may be routing `/api/live/chat/realtime` to the React app or Lambda instead of the GPU ALB.
- ALB must have a listener rule for `/api/live/chat/realtime` to the `live-gateway` target group.