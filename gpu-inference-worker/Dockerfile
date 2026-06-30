# syntax=docker/dockerfile:1.7

FROM nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_MAJOR=20
ARG GPT_SOVITS_ARCHIVE=docker/vendor/GPT-SoVITS.zip

ENV NODE_ENV=production \
    WORKER_HOST=0.0.0.0 \
    WORKER_PORT=3001 \
    GPT_SOVITS_ROOT=/opt/gpt-sovits \
    PYTHON_EXEC=/opt/gpt-sovits/venv/bin/python \
    INFERENCE_HOST=127.0.0.1 \
    INFERENCE_PORT=9880 \
    LOCAL_TEMP_ROOT=/opt/gpt-sovits/worker_temp \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      ffmpeg \
      git \
      gnupg \
      libgl1 \
      libglib2.0-0 \
      libsndfile1 \
      libsm6 \
      libsox-dev \
      libxext6 \
      software-properties-common \
      unzip \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      python3.9 \
      python3.9-dev \
      python3.9-venv \
    && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/gpu-inference-worker

COPY gpu-inference-worker/package*.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY gpu-inference-worker/ ./
COPY docker/gpu-inference-worker/entrypoint.sh /usr/local/bin/voice-gpu-inference-worker-entrypoint
COPY ${GPT_SOVITS_ARCHIVE} /tmp/GPT-SoVITS.zip

RUN mkdir -p "$GPT_SOVITS_ROOT" /tmp/gpt-sovits-unpack \
    && unzip -q /tmp/GPT-SoVITS.zip -d /tmp/gpt-sovits-unpack \
    && if [ -d /tmp/gpt-sovits-unpack/GPT-SoVITS ]; then \
         cp -a /tmp/gpt-sovits-unpack/GPT-SoVITS/. "$GPT_SOVITS_ROOT"/; \
       else \
         cp -a /tmp/gpt-sovits-unpack/. "$GPT_SOVITS_ROOT"/; \
       fi \
    && python3.9 -m venv "$GPT_SOVITS_ROOT/venv" \
    && "$PYTHON_EXEC" -m pip install --upgrade pip setuptools wheel \
    && "$PYTHON_EXEC" -m pip install \
      torch==2.1.1 \
      torchvision==0.16.1 \
      torchaudio==2.1.1 \
      --index-url https://download.pytorch.org/whl/cu118 \
    && "$PYTHON_EXEC" -m pip install -r "$GPT_SOVITS_ROOT/requirements.txt" \
    && "$PYTHON_EXEC" -m pip install "fastapi<0.112.2" "uvicorn[standard]" attrdict faster-whisper resemblyzer \
    && mkdir -p \
      "$LOCAL_TEMP_ROOT" \
      "$GPT_SOVITS_ROOT/GPT_weights_v2" \
      "$GPT_SOVITS_ROOT/SoVITS_weights_v2" \
    && chmod +x /usr/local/bin/voice-gpu-inference-worker-entrypoint \
    && rm -rf /tmp/GPT-SoVITS.zip /tmp/gpt-sovits-unpack /root/.cache/pip

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.WORKER_PORT || 3001) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["voice-gpu-inference-worker-entrypoint"]
CMD ["worker"]
