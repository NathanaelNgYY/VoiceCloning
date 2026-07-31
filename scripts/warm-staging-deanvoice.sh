#!/usr/bin/env bash
set -euo pipefail

worker_url="${VCS_WORKER_URL:-http://127.0.0.1:3003}"
route_warm_rounds="${VCS_ROUTE_WARM_ROUNDS:-10}"
synthesis_concurrency="${SYNTHESIS_MAX_CONCURRENCY:-1}"
if ! [[ "${route_warm_rounds}" =~ ^[0-9]+$ ]] \
  || ((route_warm_rounds < 1 || route_warm_rounds > 20)); then
  echo 'VCS_ROUTE_WARM_ROUNDS must be an integer from 1 to 20.' >&2
  exit 1
fi
if ! [[ "${synthesis_concurrency}" =~ ^[0-9]+$ ]] \
  || ((synthesis_concurrency < 1 || synthesis_concurrency > 4)); then
  echo 'SYNTHESIS_MAX_CONCURRENCY must be an integer from 1 to 4.' >&2
  exit 1
fi
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

make_route_warm_body() {
  local text="$1"
  local skip_verify="$2"
  cat <<JSON
{
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
  "text":"${text}",
  "skip_verify":${skip_verify},
  "text_split_method":"cut0",
  "batch_size":1,
  "streaming_mode":false,
  "split_bucket":true,
  "parallel_infer":false,
  "fragment_interval":0.1
}
JSON
}

# One short pair proved that both local scheduler slots worked, but the first public
# event wave was still materially slower than the same fleet after real traffic. Run
# repeated representative pairs so both first-chunk (verification skipped) and later-
# chunk (verification enabled) paths are hot before capacity is advertised. Ten rounds
# approximate the per-GPU synthesis count from the first successful event wave while
# still fitting comfortably inside the scheduled prewarm window.
route_warm_texts=(
  "Gastrointestinal bleeding means bleeding somewhere inside the digestive tract."
  "It may appear as vomiting blood, black stools, or fresh blood from the rectum."
  "Doctors assess the severity, identify the source, and treat the underlying cause."
)
route_warm_paths=()
cleanup_route_warm() {
  local route_warm_path
  for route_warm_path in "${route_warm_paths[@]}"; do
    rm -f "${route_warm_path}"
  done
}
trap cleanup_route_warm EXIT

# Exercise every configured same-model synthesis slot concurrently in every round
# before Target Optimizer starts. Every response must be a real WAV. The first item
# in each three-text cycle matches the production first-chunk skip-verification path;
# the remaining items exercise the verified later-chunk path.
for ((route_warm_round = 1; route_warm_round <= route_warm_rounds; route_warm_round += 1)); do
  route_warm_index=$(((route_warm_round - 1) % ${#route_warm_texts[@]}))
  if ((route_warm_index == 0)); then
    route_warm_skip_verify=true
  else
    route_warm_skip_verify=false
  fi
  route_warm_body="$(
    make_route_warm_body \
      "${route_warm_texts[route_warm_index]}" \
      "${route_warm_skip_verify}"
  )"
  route_warm_round_started_at="${SECONDS}"
  route_warm_round_paths=()
  route_warm_round_pids=()
  for ((route_warm_slot = 1; route_warm_slot <= synthesis_concurrency; route_warm_slot += 1)); do
    route_warm_path="/tmp/vcs-staging-deanvoice-route-warm-${route_warm_round}-${route_warm_slot}.wav"
    route_warm_paths+=("${route_warm_path}")
    route_warm_round_paths+=("${route_warm_path}")
    post_json /inference/tts 300 "${route_warm_body}" > "${route_warm_path}" &
    route_warm_round_pids+=("$!")
  done
  route_warm_failed=0
  for route_warm_pid in "${route_warm_round_pids[@]}"; do
    if ! wait "${route_warm_pid}"; then
      route_warm_failed=1
    fi
  done
  if [[ "${route_warm_failed}" -ne 0 ]]; then
    echo "DeanVoice ${synthesis_concurrency}-slot route warm round ${route_warm_round} failed." >&2
    exit 1
  fi

  for route_warm_path in "${route_warm_round_paths[@]}"; do
    if [[ "$(head -c 4 "${route_warm_path}")" != "RIFF" ]]; then
      echo "DeanVoice ${synthesis_concurrency}-slot route warm did not return RIFF for ${route_warm_path}." >&2
      exit 1
    fi
    rm -f "${route_warm_path}"
  done
  echo "warm_timing route_warm_round=${route_warm_round} seconds=$((SECONDS - route_warm_round_started_at))"
done
trap - EXIT
finish_phase "route_level_${synthesis_concurrency}_slot_synthesis"

status="$(curl --fail --silent --show-error "${worker_url}/inference/status")"
if [[ "${status}" != *'"ready":true'* ]]; then
  echo "DeanVoice warm finished without ready status: ${status}" >&2
  exit 1
fi

echo "warm_timing total_seconds=$((SECONDS - total_started_at))"
echo 'DeanVoice staging warm completed.'
