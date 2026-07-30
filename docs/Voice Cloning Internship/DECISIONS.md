# Technical Decisions

## Architecture

- The app is split into separate runtime roles instead of one monolith:
  - `lambda/` handles browser-facing REST orchestration.
  - `gpu-worker/` handles training-oriented GPU work.
  - `gpu-inference-worker/` handles model loading and inference-oriented GPU work.
  - `live-gateway/` owns the browser WebSocket and OpenAI Realtime bridge.

## Frontend Deployment Shape

- The deployed frontend is expected to use same-origin CloudFront paths rather than calling raw backend origins directly.
- `/api/*` goes through Lambda Function URL.
- Browser SSE and the live WebSocket go through the GPU ALB.

## Storage Model

- S3 is the canonical shared storage for uploaded audio, training assets, and model artifacts.
- GPU EC2 local disk is treated as working cache/scratch space, not source of truth.

## Pronunciation Dictionary

- Admin pronunciation entries require ARPAbet. Legacy `readable` fields remain ignored, but an optional validated `synthesisAlias` may rewrite one exact saved word into a reviewed multi-part English spelling. ASR must verify the rewritten tokens, and strict phoneme mode must score the full alias span against the entry's ARPAbet so aliases cannot bypass verification.
- Category is organizational metadata, not part of pronunciation identity. A normalized English word has one global entry; saving moves/replaces it across categories and runtime defensively selects the newest legacy record.

## Live Audio Strategy

- OpenAI Realtime is used for text conversation/transcription behavior.
- GPT-SoVITS is the only audible assistant voice in Live Fast.
- Live Fast playback is phrase-based, so punctuation quality in assistant text is operationally important.

## Multi-user GPU Strategy

- Voice/model identity is immutable per request and per active browser conversation;
  a global UI/profile change must never mutate an in-flight user's voice.
- The inference worker owns one bounded scheduler. Same-model work may use the tested
  physical concurrency (currently 2 on g6.xlarge); model changes are atomic and wait
  for the active batch to drain.
- Full-inference session state, events, chunks, cancellation, and final artifacts use
  S3 as shared state so any horizontally-routed target can continue the session.
- Training remains a separate serial queued service on the fixed training target.
- Staging scales the existing EC2 inference service with ALB Target Optimizer and an
  ASG. SageMaker training jobs are not an inference-serving replacement; a SageMaker
  endpoint migration is deferred beyond the 2026-08-03 deadline.
- Scale-out is rejection-based, not completed-request-rate-based: after a configurable
  rejection count in one ALB metric minute, add a configurable fixed number of GPUs.
  Live/default is one rejection and +10. The free-capacity condition was removed
  because sampled free slots coexisted with real 504s. Measure false scale-outs and
  GPU-hours; a true 30-second reaction requires a custom high-resolution metric.
  Idle scale-in removes one instance after fifteen no-traffic minutes.
- Retry priority is intentionally local, not global. ALB/Target Optimizer chooses a
  target without knowing retry priority. Once an admitted request reaches a worker,
  `X-VCS-Capacity-Retry` places it ahead of normal local queued work while preserving
  FIFO within each lane. Do not claim end-to-end retry priority.
- The GI student client must not load/warm the shared voice when every student enters.
  Each ASG node owns preparation and exposes Target Optimizer only after loading the
  model, caching the primary plus auxiliary references, running throwaway synthesis,
  and validating two concurrent real-route RIFF syntheses before advertising its two
  slots. This prevents a redundant user-entry warm burst and single-slot false readiness.
- Scheduled prewarming is the event safety mechanism. Reactive scaling is retained for
  sustained unforeseen demand but cannot hide the several-minute GPU launch/model-load
  delay from the burst that triggered it.

## Evaluated Scaling Improvements

- Keep the current scheduled EC2 prewarm for the event. It is already production-shaped
  and tested, but running GPUs cost money during the scheduled window and the fleet is
  currently single-AZ.
- A faster Lambda retry with short jitter may use newly freed slots sooner. It also
  increases Lambda/ALB attempts, cost, reject noise, and thundering-herd risk, and it
  still cannot guarantee global retry ordering.
- A durable shared dispatcher can provide true global priority and buffer bursts. It
  requires an asynchronous job contract, persistence, idempotency, completion delivery,
  and fairness rules so retries cannot starve new users.
- SageMaker Asynchronous Inference is a post-event research option for managed queueing
  and scale-to-zero. It is near-real-time, uses S3 request/result objects, and would
  require migrating the current worker/container and redesigning immediate first-audio
  playback; it is not a drop-in replacement for the synchronous chatbot route.
- A SageMaker real-time endpoint offers managed hosting/autoscaling but still has cold
  scale-out delay, ongoing GPU cost, and migration risk for model switching, reference
  caches, local scheduling, and shared Live Full state.
- A stopped EC2 warm pool may retain initialized EBS blocks and lifecycle state, but it
  loses RAM/GPU model state and still requires service/model startup. It adds EBS cost
  and lifecycle-hook complexity and must beat the measured 272-275 second final-AMI
  launch before adoption. A running warm pool is faster but costs nearly the same as
  scheduled active GPUs. Hibernation/CUDA restoration must be proven, not assumed.
- EBS Fast Snapshot Restore or deliberate block pre-reading may reduce snapshot
  first-read cost, but adds per-AZ cost/operations and cannot remove Python/model load.
- High-resolution custom capacity publishing could represent continuous fullness more
  accurately than sampled Target Optimizer metrics, but adds a publisher, alarm failure
  semantics, monitoring cost, and maintenance.
- Because future user turns cannot be predicted and a new GPU takes several minutes
  to prepare, evaluate proactive scale-out at roughly 50-75% utilization for three
  consecutive 10-second samples. Busy means an occupied synthesis slot: one generation
  uses one of the deployed GPU's two slots, so that GPU is 50% occupied rather than
  full. Prefer fleet-wide occupied slots divided by total slots so the rule adapts to
  fleet size; use 10-30 busy GPUs only as an optional minimum guard. This requires a
  high-resolution custom metric because the current one-minute Target Optimizer metric
  cannot provide a true 30-second window. Require a cooldown, slow scale-in, cost/
  latency measurements, and rehearsal before replacing the strict alarm.
- Multi-AZ private capacity improves resilience and capacity availability, but adds
  networking/NAT cost, duplicate caches, routing work, and additional permissions.
- WebSocket reconnect/resume is the relevant improvement for the two code-1006 test
  losses. It adds conversation-resume, duplicate-event, and idempotency complexity and
  is separate from GPU autoscaling.

## Future Multi-user Training and Live Full

- The current in-memory serial training queue is admission control, not horizontal
  scaling. A restart can lose queued jobs and one fixed GPU remains the bottleneck.
- Multi-user training should use durable job records, immutable per-job S3 prefixes,
  leases, idempotent completion, checkpoints, cancellation, quotas, and explicit model
  activation. Candidate platforms are a queue-backed training ASG/AWS Batch or one
  SageMaker Training Job per user. The first reuses more code but keeps EC2 operations;
  the second provides managed isolation but requires a full training-container,
  progress, quota, cache/startup, and cost migration.
- Training autoscaling should consider estimated remaining GPU work, not only queue
  length, because training durations vary substantially.
- Shared S3 hydration makes Live Full recoverable across inference targets, but does not
  by itself make concurrent session mutation safe. Worker-local leases must be replaced
  or supplemented with a distributed lease/fencing token and conditional manifest
  revisions before multiple targets can edit one session.
- The first horizontally safe Live Full design should keep one session owned by one GPU
  at a time and use durable asynchronous job/progress state. Chunk-level parallelism is
  optional later: it may reduce completion time, but increases GPU use per user and can
  create cross-GPU prosody, loudness, ordering, retry, cancellation, and reconstruction
  inconsistencies.

## Frontend Surface Split

- Training and Live Fast are the current user-facing surfaces.
- App-mode gating supports separate training and live-fast builds from the same frontend codebase.

## Training Quality Strategy

- The GPU training pipeline now targets GPT-SoVITS `v2ProPlus`, including the speaker-verification embedding extraction step it requires.
- `Skip denoise` is kept as an operator-controlled training option for already-clean recordings because denoise can introduce artifacts that hurt timbre similarity.
- Reference selection should prefer cleaner clips in the ~3-9 second range; the frontend now follows that rule and `gpu-worker/scripts/score_clips.py` exists to validate or inspect candidate clips offline.
