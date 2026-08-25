#!/usr/bin/env bash
set -euo pipefail

worker_url="${VCS_WORKER_URL:-http://127.0.0.1:3003}"
route_warm_rounds="${VCS_ROUTE_WARM_ROUNDS:-10}"
synthesis_concurrency="${SYNTHESIS_MAX_CONCURRENCY:-1}"
# A coordinator claim always wins. Only a scheduled/minimum boot with no pending
# assignment uses this fallback, which deliberately stays on Dean rather than a
# mutable globally active profile.
: "${S3_BUCKET:?S3_BUCKET is required for boot warm}"
: "${S3_REGION:?S3_REGION is required for boot warm}"
s3_prefix="${S3_PREFIX:-}"
default_voice_profile_id="${VCS_DEFAULT_VOICE_PROFILE_ID:-deanvoice-v1}"
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

warm_body=""
coordinator_function="${MODEL_COORDINATOR_FUNCTION_NAME:-}"
if [[ -n "${coordinator_function}" ]]; then
  imds_token="$(curl --fail --silent --show-error --max-time 2 \
    --request PUT \
    --header 'X-aws-ec2-metadata-token-ttl-seconds: 60' \
    http://169.254.169.254/latest/api/token 2>/dev/null || true)"
  instance_id=""
  if [[ -n "${imds_token}" ]]; then
    instance_id="$(curl --fail --silent --show-error --max-time 2 \
      --header "X-aws-ec2-metadata-token: ${imds_token}" \
      http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || true)"
  fi
  claim_path="/tmp/vcs-model-coordinator-claim.json"
  if [[ -n "${instance_id}" ]] && aws lambda invoke \
    --function-name "${coordinator_function}" \
    --region "${MODEL_COORDINATOR_REGION:-${S3_REGION}}" \
    --cli-binary-format raw-in-base64-out \
    --payload "$(jq -nc --arg instance_id "${instance_id}" '{action:"claim", instanceId:$instance_id}')" \
    "${claim_path}" >/dev/null; then
    warm_body="$(jq -c '.assignment.synthesisBody // empty' "${claim_path}")"
  else
    echo "Coordinator boot claim was unavailable; using ${default_voice_profile_id}." >&2
  fi
  rm -f "${claim_path}"
fi

if [[ -z "${warm_body}" ]]; then
  active_profile="$(
    aws s3 cp \
      "s3://${S3_BUCKET}/${s3_prefix}voice-profiles/${default_voice_profile_id}.json" - \
      --region "${S3_REGION}"
  )"
  voice_profile_id="$(jq -er '.voiceProfileId | select(type == "string" and length > 0)' <<<"${active_profile}")"
  gpt_key="$(jq -er '(.gptKey // .gptPath) | select(type == "string" and length > 0)' <<<"${active_profile}")"
  sovits_key="$(jq -er '(.sovitsKey // .sovitsPath) | select(type == "string" and length > 0)' <<<"${active_profile}")"
  warm_body="$(jq -c \
    --arg voice_profile_id "${voice_profile_id}" \
    --arg gpt_ref "${gpt_key}" \
    --arg sovits_ref "${sovits_key}" '
    {
      voiceProfileId,
      ref_audio_path,
      aux_ref_audio_paths: (.aux_ref_audio_paths // []),
      prompt_text: (.prompt_text // ""),
      prompt_lang: (.prompt_lang // "en"),
      text_lang: (.text_lang // .prompt_lang // "en"),
      warm_text: "The staging voice is ready.",
      voice_model: {
        voiceProfileId: $voice_profile_id,
        gptRef: $gpt_ref,
        sovitsRef: $sovits_ref,
        revision: (.updatedAt // .revision // "")
      }
    }
    | select(.ref_audio_path | type == "string" and length > 0)
  ' <<<"${active_profile}")"
else
  voice_profile_id="$(jq -er '(.voice_model.voiceProfileId // .voiceProfileId) | select(type == "string" and length > 0)' <<<"${warm_body}")"
  gpt_key="$(jq -er '.voice_model.gptRef | select(type == "string" and length > 0)' <<<"${warm_body}")"
  sovits_key="$(jq -er '.voice_model.sovitsRef | select(type == "string" and length > 0)' <<<"${warm_body}")"
  echo "Claimed coordinator boot assignment for ${voice_profile_id}."
fi
if [[ -z "${warm_body}" ]]; then
  echo "Voice profile ${voice_profile_id} has no reference audio." >&2
  exit 1
fi

gpt_result="$(post_json /models/download 180 \
  "$(jq -nc --arg s3Key "${gpt_key}" '{s3Key: $s3Key}')")"
finish_phase "gpt_model_cache"
sovits_result="$(post_json /models/download 180 \
  "$(jq -nc --arg s3Key "${sovits_key}" '{s3Key: $s3Key}')")"
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

post_json /ref-audio/warm 300 "${warm_body}"
finish_phase "reference_cache_and_synthesis"

make_route_warm_body() {
  local text="$1"
  local skip_verify="$2"
  jq -c \
    --arg text "${text}" \
    --argjson skip_verify "${skip_verify}" \
    '. + {
      text: $text,
      skip_verify: $skip_verify,
      text_split_method: "cut0",
      batch_size: 1,
      streaming_mode: false,
      split_bucket: true,
      parallel_infer: false,
      fragment_interval: 0.1
    }' <<<"${warm_body}"
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
  # Exercises an opt-in strict dictionary entry so the lazy phoneme CTC model is
  # loaded before Target Optimizer advertises this instance to users.
  "Catalase catalyzes a reaction."
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
    echo "Profile ${voice_profile_id} ${synthesis_concurrency}-slot route warm round ${route_warm_round} failed." >&2
    exit 1
  fi

  for route_warm_path in "${route_warm_round_paths[@]}"; do
    if [[ "$(head -c 4 "${route_warm_path}")" != "RIFF" ]]; then
      echo "Profile ${voice_profile_id} ${synthesis_concurrency}-slot route warm did not return RIFF for ${route_warm_path}." >&2
      exit 1
    fi
    rm -f "${route_warm_path}"
  done
  echo "warm_timing route_warm_round=${route_warm_round} seconds=$((SECONDS - route_warm_round_started_at))"
done
trap - EXIT
finish_phase "route_level_${synthesis_concurrency}_slot_synthesis"

# The direct model/ref warm endpoints do not populate the coordinator's
# in-memory residency identity. Finalize through the authenticated registration
# endpoint so this worker becomes routable for the exact claimed profile without
# reloading or changing weights.
if [[ -n "${coordinator_function}" ]]; then
  coordinator_auth_token="${MODEL_COORDINATOR_AUTH_TOKEN:-}"
  if [[ -z "${coordinator_auth_token}" ]]; then
    echo 'MODEL_COORDINATOR_AUTH_TOKEN is required to register boot residency.' >&2
    exit 1
  fi
  registration_body="$(jq -nc --argjson synthesis_body "${warm_body}" \
    '{synthesisBody: $synthesis_body, requiredIdleMs: 0}')"
  registration_result="$(curl --fail --silent --show-error \
    --max-time 300 \
    --header 'Content-Type: application/json' \
    --header "X-VCS-Coordinator-Token: ${coordinator_auth_token}" \
    --data-binary "${registration_body}" \
    "${worker_url}/coordinator/register")"
  if [[ "$(jq -r '.registered // false' <<<"${registration_result}")" != 'true' ]]; then
    echo 'Boot warm completed but coordinator residency registration failed.' >&2
    exit 1
  fi
  finish_phase "coordinator_residency_registration"
fi

status="$(curl --fail --silent --show-error "${worker_url}/inference/status")"
if [[ "${status}" != *'"ready":true'* ]]; then
  echo "DeanVoice warm finished without ready status: ${status}" >&2
  exit 1
fi

echo "warm_timing total_seconds=$((SECONDS - total_started_at))"
echo "Staging boot warm completed for ${voice_profile_id}."
