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
- Entra tokens for authenticated Lambda REST calls use `X-VCS-Entra-Token`, not `Authorization`:
  Lambda-origin OAC always signs with SigV4 and owns the standard header. Gateway/WebSocket auth
  keeps its bearer/frame transport because those paths do not traverse Lambda OAC.

## Storage Model

- S3 is the canonical shared storage for uploaded audio, training assets, and model artifacts.
- GPU EC2 local disk is treated as working cache/scratch space, not source of truth.

## Lesson Behavior Analytics

- Dev GI uses same-origin Lambda ingestion with small client batches written as
  gzip NDJSON under hourly S3 partitions. Firehose/Kinesis is deferred until measured
  volume requires buffering; Glue/Athena and a dashboard are separate query-layer work.
- Current batches are session-anonymous and exclude mock-auth identity. Future SSO
  identity must be derived from a backend-validated token, not a browser field.
- The dev-first identified design is implemented locally: Lambda validates the token,
  writes only verified `oid` as the analytics subject, maps video times through an authored
  lesson concept map, and aggregates cautious evidence in a dev-only DynamoDB table.
- Learner summaries use conservative support-signal thresholds and may use a structured OpenAI response;
  API failure or missing credentials falls back to deterministic wording. The chatbot gets
  only the compact summary, never another user's history or an unsupported formal grade.
- Derived support signals are per learner, lesson, and concept in a rolling 30-day window.
  Rewinds contribute `0.5` at most twice and clarification requests contribute `1` at most
  twice; the internal support score caps at `3` and retained qualifying count caps at four.
  Long pauses and transcript scrolling remain only in the immutable event log and contribute
  nothing to the support state. Event IDs are idempotent and reads recalculate recency.
  Positive mastery remains unimplemented until a trustworthy correctness signal exists.
- Supervisor reads require an Entra `Supervisor` app role (with an explicit OID allowlist
  only as a temporary provisioning bridge), and query a user index rather than scanning.
  Supervisors may reset one learner concept; the backend rebuilds the affected summary.
- Rewinds, skips, and long transcript pauses are ambiguous signals. They may calibrate
  a relevant chatbot answer or prompt a check for understanding, but cannot establish
  that a learner is confused, clear, attentive, or has mastered the material.
- Explanation style is separate from concept support. A detailed current-turn request such as
  “explain like I am nine while preserving medical terms” must be followed as written; a
  generic simplification request supports only generic simplification. Persistent style
  preferences require a separate learner-controlled model and are future work, alongside
  learner confirmation prompts and concept knowledge checks.
- Concept ranking is supervisor presentation only. The chatbot ignores `focusConcepts`, receives
  every concept with a current support state, first resolves the concept in the current question,
  and applies only the matching entry; an
  unrelated higher-ranked concept must never redirect the answer.

## Pronunciation Dictionary

- Admin pronunciation entries require ARPAbet. Legacy `readable` fields remain ignored, but an optional validated `synthesisAlias` may rewrite one exact saved word into a reviewed multi-part English spelling. ASR must verify the rewritten tokens, and strict phoneme mode must score the full alias span against the entry's ARPAbet so aliases cannot bypass verification.
- Category is organizational metadata, not part of pronunciation identity. A normalized English word has one global entry; saving moves/replaces it across categories and runtime defensively selects the newest legacy record.

## Live Audio Strategy

- OpenAI Realtime is used for text conversation/transcription behavior.
- GPT-SoVITS is the only audible assistant voice in Live Fast.
- The staging Lambda eagerly initializes the Live handler at 512 MB. GI freezes the
  active profile's GPT/SoVITS refs into each conversation so synthesis does not reread
  S3 per clip. This is payload-driven rather than a global resolver bypass: regular
  Live Fast/Full already supplies its selected-model snapshot, while ID-only direct
  inference/TTS callers continue through saved-profile resolution. Provisioned
  concurrency/versioned aliases remain optional future work.
- Live Fast playback is phrase-based, so punctuation quality in assistant text is operationally important.
- The first Live Fast/chatbot reply clip deliberately sets `skip_verify=true` to
  protect time-to-first-audio (`6cd6de0`, backend support `4e37c58`). This bypasses
  ASR/phoneme/speaker verification for that first clip only; later clips retain live
  verification and Live Full/Queue remains fully verified. This is distinct from a
  missing verification dependency. Public-prime probes no longer use `skip_verify`.
- In staging Live Fast phrase mode, a multi-sentence reply may begin TTS after a
  conservative streamed boundary: the first sentence is complete and following
  sentence text has begun. This avoids speaking unstable punctuation. Single-sentence,
  Live Full, and non-phrase replies retain completion-based behavior.

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
- Scale-out uses occupied synthesis slots divided by tested fleet capacity
  (`HealthyHostCount * 2`), including the baseline GPU, at a 70% threshold. Below
  five healthy GPUs, a qualifying one-minute sample sets capacity to five; at five
  or more, it adds ten and re-evaluates later samples. The former rejection alarm is
  telemetry-only. A true roughly 30-second reaction requires a custom fleet-wide
  high-resolution metric; changing the existing alarm period alone is insufficient.
  Idle scale-in removes one instance after fifteen no-traffic minutes.
- Treat capacity admission and network transit as separate latency domains. The final
  150-user first-turn p95 was dominated by retry backoff, while two later maxima were
  mostly outside Lambda. Scale on high-resolution capacity pressure; use client and
  edge timing to investigate transit. Provisioned concurrency addresses neither.
- The next scaling experiment publishes occupied slots, total slots, no-capacity
  responses, and pending admissions every 10 seconds. No-capacity/pending demand must
  participate in scale-out rather than relying only on averaged occupancy. Compare
  short jittered retries with a centralized fair queue. A known simultaneous 150-user
  event must prewarm additional capacity and be tested both as an immediate burst and
  with arrivals spread across 30-60 seconds.
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
- A public prime marker proves that each node originated and received a valid public
  synthesis, not that ALB routed that request back to the same node. Strict per-target
  public readiness requires a separate warm target group/route and promotion lifecycle.

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
