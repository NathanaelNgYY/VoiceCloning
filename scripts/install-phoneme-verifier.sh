#!/usr/bin/env bash
set -euo pipefail

python_exec="${PYTHON_EXEC:-/home/ubuntu/miniconda3/envs/gptsovits/bin/python}"
model_name="${PHONEME_MODEL:-facebook/wav2vec2-lv-60-espeak-cv-ft}"

if [[ ! -x "${python_exec}" ]]; then
  echo "Python interpreter is not executable: ${python_exec}" >&2
  exit 1
fi

if ! command -v espeak-ng >/dev/null 2>&1; then
  sudo apt-get update
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    espeak-ng libespeak-ng1
fi

"${python_exec}" -m pip install --disable-pip-version-check 'phonemizer==3.4.0'

# Download both processor metadata and weights into the AMI owner's Hugging Face
# cache. Without this, the first strict word becomes a network/model cold start.
PHONEME_MODEL="${model_name}" "${python_exec}" - <<'PY'
import os
from transformers import AutoModelForCTC, AutoProcessor

name = os.environ["PHONEME_MODEL"]
AutoProcessor.from_pretrained(name)
AutoModelForCTC.from_pretrained(name)
print(f"phoneme verifier cache ready: {name}")
PY
