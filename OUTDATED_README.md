# Voice Cloning Studio

This branch is set up to run as a single deployable web app instead of only as two local dev servers. The Express server can now serve the built React client, read config from injected environment variables, and run cleanly on Linux-based AWS hosts and containers.

## What changed for cloud deployment

- The server now reads configuration from environment variables first, with optional `server/.env` loading for local development.
- Ports, bind host, inference port, proxy trust, CORS, client dist serving, and writable runtime paths are environment-driven.
- Windows-only subprocess path handling was removed so the Python child processes work on Linux/AWS too.
- Runtime directories can be moved to EFS/EBS-backed mounts with:
  `VOICE_CLONING_DATA_ROOT`, `VOICE_CLONING_LOG_ROOT`, `VOICE_CLONING_TEMP_ROOT`, `SOVITS_WEIGHTS_DIR`, and `GPT_WEIGHTS_DIR`.
- `GET /healthz` and `GET /readyz` were added for ALB, ECS, App Runner, or EC2 health checks.
- The server now shuts down child processes cleanly on `SIGTERM`, which matters during ECS/App Runner task replacement.
- The React app now supports `VITE_API_BASE_URL` and `VITE_APP_BASENAME`, so it can run same-origin behind Express or from a separate frontend origin.
- A multi-stage `Dockerfile` and `.dockerignore` were added for AWS container workflows.

## Important AWS note

This repository does not contain the full GPT-SoVITS runtime itself. In single-host deployments, `GPT_SOVITS_ROOT` must point to a Linux-ready GPT-SoVITS installation that already contains its Python runtime and model dependencies. In split-host deployments, the backend can run without `GPT_SOVITS_ROOT`, but the GPU worker still needs it because the worker owns `api_v2.py`, model loading, and transcription.

Typical AWS layout:

1. Build this repo into a container with the included `Dockerfile`.
2. Mount or bake your GPT-SoVITS installation into the container, for example at `/opt/gpt-sovits`.
3. Mount persistent storage for data, logs, temp files, and weights, usually EFS or an attached volume.
4. Set the matching environment variables in ECS/App Runner/EC2.

## Recommended environment variables

Required:

```env
GPT_SOVITS_ROOT=/opt/gpt-sovits
```

Useful production defaults:

```env
NODE_ENV=production
PORT=3000
SERVER_HOST=0.0.0.0
SERVE_CLIENT_DIST=true
TRUST_PROXY=true
INFERENCE_MODE=local
INFERENCE_HOST=127.0.0.1
INFERENCE_PORT=9880
```

Split-host backend defaults:

```env
NODE_ENV=production
PORT=3000
SERVER_HOST=0.0.0.0
SERVE_CLIENT_DIST=true
TRUST_PROXY=true
STORAGE_MODE=s3
INFERENCE_MODE=remote
S3_BUCKET=my-voice-cloning-bucket
S3_REGION=ap-southeast-1
GPU_WORKER_HOST=10.0.2.25
GPU_WORKER_PORT=3001
```

Split-host GPU worker defaults:

```env
GPT_SOVITS_ROOT=/opt/gpt-sovits
WORKER_HOST=0.0.0.0
WORKER_PORT=3001
INFERENCE_HOST=127.0.0.1
INFERENCE_PORT=9880
S3_BUCKET=my-voice-cloning-bucket
S3_REGION=ap-southeast-1
```

Recommended persistent storage overrides:

```env
VOICE_CLONING_DATA_ROOT=/mnt/voice-data/data
VOICE_CLONING_LOG_ROOT=/mnt/voice-data/logs
VOICE_CLONING_TEMP_ROOT=/mnt/voice-data/temp
SOVITS_WEIGHTS_DIR=/mnt/voice-data/weights/sovits
GPT_WEIGHTS_DIR=/mnt/voice-data/weights/gpt
```

Optional separate-frontend settings:

```env
CORS_ORIGINS=https://voice.example.com
VITE_API_BASE_URL=https://api.example.com
VITE_APP_BASENAME=/
```

## Local development

Backend:

```powershell
cd server
copy .env.example .env
npm run dev
```

Frontend:

```powershell
cd client
npm run dev
```

Then open `http://localhost:5173`.

## Production build

Build the client once:

```powershell
cd client
npm run build
```

Run the server:

```powershell
cd server
npm start
```

When `SERVE_CLIENT_DIST=true`, the backend serves the built SPA from `client/dist`.

## Docker

Build:

```powershell
docker build -t voice-cloning-studio .
```

Run:

```powershell
docker run -p 3000:3000 `
  -e GPT_SOVITS_ROOT=/opt/gpt-sovits `
  -e VOICE_CLONING_DATA_ROOT=/mnt/voice-data/data `
  -e VOICE_CLONING_LOG_ROOT=/mnt/voice-data/logs `
  -e VOICE_CLONING_TEMP_ROOT=/mnt/voice-data/temp `
  -e SOVITS_WEIGHTS_DIR=/mnt/voice-data/weights/sovits `
  -e GPT_WEIGHTS_DIR=/mnt/voice-data/weights/gpt `
  -v /host/gpt-sovits:/opt/gpt-sovits `
  -v /host/voice-data:/mnt/voice-data `
  voice-cloning-studio
```

## Operational constraints

- Training progress and inference progress are stored in-memory per instance. If you run multiple AWS tasks behind a load balancer, use sticky sessions or keep the app on a single task.
- The app intentionally allows only one training job and one streaming generation job at a time per instance, which is usually the safest model for a single GPU worker.
- If you host the frontend separately on S3/CloudFront, configure a rewrite to `index.html` for SPA routes.
