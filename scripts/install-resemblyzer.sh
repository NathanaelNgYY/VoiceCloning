#!/usr/bin/env bash
set -euo pipefail

python_exec="${PYTHON_EXEC:-/home/ubuntu/miniconda3/envs/gptsovits/bin/python}"

if [[ ! -x "${python_exec}" ]]; then
  echo "Python interpreter is not executable: ${python_exec}" >&2
  exit 1
fi

"${python_exec}" -m pip install --disable-pip-version-check 'resemblyzer==0.1.4'
"${python_exec}" -c 'from resemblyzer import VoiceEncoder, preprocess_wav; print("resemblyzer import OK")'
