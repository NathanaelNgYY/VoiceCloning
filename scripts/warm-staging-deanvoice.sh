#!/usr/bin/env bash
set -euo pipefail

worker_url="${VCS_WORKER_URL:-http://127.0.0.1:3003}"
total_started_at="${SECONDS}"
phase_started_at="${SECONDS}"

finish_phase() {
  local phase="$1"
  local now="${SECONDS}"
  echo "warm_timing phase=${phase} seconds=$((now - phase_started_at))"
  phase_started_at="${now}"
}

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
finish_phase "wait_for_worker"

gpt_result="$(post_json /models/download 180 \
  '{"s3Key":"models/user-models/gpt/DeanVoice-e25.ckpt"}')"
finish_phase "gpt_model_cache"
sovits_result="$(post_json /models/download 180 \
  '{"s3Key":"models/user-models/sovits/DeanVoice_e20_s2260.pth"}')"
finish_phase "sovits_model_cache"

gpt_path="$(printf '%s' "${gpt_result}" | sed -n 's/.*"localPath":"\([^"]*\)".*/\1/p')"
sovits_path="$(printf '%s' "${sovits_result}" | sed -n 's/.*"localPath":"\([^"]*\)".*/\1/p')"
if [[ -z "${gpt_path}" || -z "${sovits_path}" ]]; then
  echo 'DeanVoice model download did not return local paths.' >&2
  exit 1
fi

post_json /inference/weights/pair 420 \
  "{\"gptPath\":\"${gpt_path}\",\"sovitsPath\":\"${sovits_path}\"}"
finish_phase "load_weight_pair"

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
finish_phase "reference_cache_and_synthesis"

route_warm_path="/tmp/vcs-staging-deanvoice-route-warm.wav"
post_json /inference/tts 300 '{
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
  "text":"Gastrointestinal bleeding means bleeding somewhere inside the digestive tract.",
  "skip_verify":true,
  "text_split_method":"cut0",
  "batch_size":1,
  "streaming_mode":false,
  "split_bucket":true,
  "parallel_infer":false,
  "fragment_interval":0.1
}' > "${route_warm_path}"
if [[ "$(head -c 4 "${route_warm_path}")" != "RIFF" ]]; then
  echo 'DeanVoice route-level warm did not return a RIFF WAV.' >&2
  exit 1
fi
rm -f "${route_warm_path}"
finish_phase "route_level_synthesis"

status="$(curl --fail --silent --show-error "${worker_url}/inference/status")"
if [[ "${status}" != *'"ready":true'* ]]; then
  echo "DeanVoice warm finished without ready status: ${status}" >&2
  exit 1
fi

echo "warm_timing total_seconds=$((SECONDS - total_started_at))"
echo 'DeanVoice staging warm completed.'
