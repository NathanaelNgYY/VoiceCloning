#!/usr/bin/env bash
set -euo pipefail

worker_url="${VCS_WORKER_URL:-http://127.0.0.1:3003}"

post_json() {
  local endpoint="$1"
  local timeout_seconds="$2"
  local body="$3"
  curl --fail --silent --show-error \
    --max-time "${timeout_seconds}" \
    --header 'Content-Type: application/json' \
    --data-binary "${body}" \
    "${worker_url}${endpoint}"
}

for _ in $(seq 1 60); do
  if curl --silent --output /dev/null "${worker_url}/inference/status"; then
    break
  fi
  sleep 2
done

gpt_result="$(post_json /models/download 180 \
  '{"s3Key":"models/user-models/gpt/DeanVoice-e25.ckpt"}')"
sovits_result="$(post_json /models/download 180 \
  '{"s3Key":"models/user-models/sovits/DeanVoice_e20_s2260.pth"}')"

gpt_path="$(printf '%s' "${gpt_result}" | sed -n 's/.*"localPath":"\([^"]*\)".*/\1/p')"
sovits_path="$(printf '%s' "${sovits_result}" | sed -n 's/.*"localPath":"\([^"]*\)".*/\1/p')"
if [[ -z "${gpt_path}" || -z "${sovits_path}" ]]; then
  echo 'DeanVoice model download did not return local paths.' >&2
  exit 1
fi

post_json /inference/weights/pair 420 \
  "{\"gptPath\":\"${gpt_path}\",\"sovitsPath\":\"${sovits_path}\"}"

post_json /ref-audio/warm 300 '{
  "voiceProfileId":"deanvoice-v1",
  "ref_audio_path":"training/datasets/DeanVoice/denoised/Speech_Dean_full_DHPM_lecture.mp3_0004481280_0004613440.wav",
  "aux_ref_audio_paths":[
    "training/datasets/DeanVoice/denoised/Speech_Dean_full_DHPM_lecture.mp3_0000340800_0000464000.wav",
    "training/datasets/DeanVoice/denoised/Speech_Dean_full_DHPM_lecture.mp3_0001180160_0001340800.wav",
    "training/datasets/DeanVoice/denoised/Speech_Dean_full_DHPM_lecture.mp3_0001525440_0001710720.wav",
    "training/datasets/DeanVoice/denoised/Speech_Dean_full_DHPM_lecture.mp3_0002227520_0002364800.wav",
    "training/datasets/DeanVoice/denoised/Speech_Dean_full_DHPM_lecture.mp3_0002661120_0002808000.wav"
  ],
  "prompt_text":" experience as well as steady hands and very sharp eyes.",
  "prompt_lang":"en",
  "text_lang":"en",
  "warm_text":"The staging voice is ready."
}'

status="$(curl --fail --silent --show-error "${worker_url}/inference/status")"
if [[ "${status}" != *'"ready":true'* ]]; then
  echo "DeanVoice warm finished without ready status: ${status}" >&2
  exit 1
fi

echo 'DeanVoice staging warm completed.'
