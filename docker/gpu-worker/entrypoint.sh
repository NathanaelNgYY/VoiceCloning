#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV="${NODE_ENV:-production}"
export GPT_SOVITS_ROOT="${GPT_SOVITS_ROOT:-/opt/gpt-sovits}"
export PYTHON_EXEC="${PYTHON_EXEC:-$GPT_SOVITS_ROOT/venv/bin/python}"
export WORKER_HOST="${WORKER_HOST:-0.0.0.0}"
export WORKER_PORT="${WORKER_PORT:-3001}"
export INFERENCE_HOST="${INFERENCE_HOST:-127.0.0.1}"
export INFERENCE_PORT="${INFERENCE_PORT:-9880}"
export LOCAL_TEMP_ROOT="${LOCAL_TEMP_ROOT:-$GPT_SOVITS_ROOT/worker_temp}"

mkdir -p \
  "$LOCAL_TEMP_ROOT" \
  "$GPT_SOVITS_ROOT/GPT_weights_v2" \
  "$GPT_SOVITS_ROOT/SoVITS_weights_v2"

case "${1:-worker}" in
  worker|gpu-worker)
    exec npm start
    ;;
  bash|sh)
    exec "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
