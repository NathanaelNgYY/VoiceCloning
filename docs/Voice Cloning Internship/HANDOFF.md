# Voice Cloning Project Handoff

Last updated: 2026-09-01

## Current State

- One application tree. Dev `separate-containers-new` and Staging `codex/staging-multi-user-scaling`
  must point at the same commit; runtime config owns the deliberate differences (Staging hides
  advanced settings, Dev does not autoscale, Dev has no Faculty).
- Dev has two fixed inference GPUs: the original is activity-managed with a 30-minute idle stop, the
  comparison GPU is manual-only. The Dev coordinator routes, reassigns and queues exactly like
  Staging but only simulates scale decisions as log/UI messages.
- Staging owns the inference ASG and is the sole authoring surface via Faculty. Publishing mirrors
  only the selected cloned-voice snapshot and category to Dev; training, analytics and transcripts
  stay isolated.
- ElevenLabs stock voices bypass the cloned-voice coordinator. A signed-in Faculty Alice response
  played while cloned Nathanael requests still had 23.1s queue waits and one timeout.

## Verification Status (read this first)

PROVEN LIVE, 2026-08-31:

- Routing to a GPU already holding the voice; two concurrent requests fill its two slots without
  scaling. Selecting a voice/lecture prepares it on TTS, Faculty and lectures.
- An idle GPU holding another voice is switched, not scaled past — including inside its 30s grace.
- Three concurrent same-voice requests: two route, the third QUEUES and is still served (~8.6s,
  `queuedAdmission: true`), and exactly one overflow GPU is prepared
  (route -> route -> queue -> post-admission scale).
- Concurrent different-voice selections during an in-flight switch neither scale nor thrash.
- Natural scale-in 2 -> 1 on the 15-minute no-traffic alarm; Dev routing-only simulation message,
  then a real reassign and a real WAV on the fixed GPU.

PROVEN LIVE/DEPLOYED, 2026-09-01:

- A real lecture request saturated the resident voice, scaled desired capacity 1 -> 2 exactly once,
  and the new worker later reached `READY`; repeated prepare polls did not scale again.
- The coordinator clears completed boots and distinguishes pending scale-out from reassignment copy.
  Faculty and lectures retry only the generated reply's speech every 15 seconds for at most 20 minutes;
  success clears stale wait banners. A signed-in browser turn confirmed the copy tracks reassignment
  versus scale-out and clears automatically at READY; one answer became playable without reprompt,
  although the frontend retry was not isolated from the backend's shorter retry window.
- Concurrent Dean/Nathanael RIFFs routed separately with zero queue wait; Live Full cancellation
  cleared its slot, and scale-in reduced 5 -> 1 newest-first, leaving the oldest baseline worker.

FAILED LIVE ON THE CURRENT DEPLOYMENT — do not call it fixed yet:
- Distributed queueing/ceiling under a simultaneous burst. Six requests with three matching READY
  GPUs stacked five onto the oldest worker, briefly exceeded the configured queue ceiling, returned
  one capacity-starting response, and unnecessarily scaled 4 -> 5 while two matching GPUs were idle.

FIXED LOCALLY, NOT DEPLOYED:
- A scoped DynamoDB lease plus expiring request rows serializes fleet selection. Tests pack six
  requests 2/2/2, spread queues across workers, stop at depth two, and automatically retry preserved
  queue/lease codes. Both local branches share one commit; AWS deployment/live proof is blocked by
  expired `VCS_AWS_*`, and remote push is blocked by unavailable GitHub authentication.
- Still not isolated end to end: frontend 15-second retry and Faculty Dev/Staging publish mirroring.

CONTRADICTION: the lecture badge showed `cs-nathanael-ng` while `client/env/staging/gi.env` pins
`deanvoice-v1`. Settle which wins after a faculty publish.

## Deployment State

- Deployed 2026-09-01: staging coordinator, Faculty and lecture bundles for truthful completed-boot,
  scale/reassignment, automatic-retry and stale-banner behavior. Prior changes are in CHANGELOG.
- Local tests: Lambda 335/335, coordinator 54/54, client 499/499, inference worker 259/259 and
  gateway 180/180; default/Live Fast/GI builds pass. `lambda/model-coordinator` needs
  its own `npm install`, or the Lambda suite fails on a missing `@aws-sdk/client-lambda`.
- No worker/AMI change needed: the worker's `SYNTHESIS_MAX_QUEUE_DEPTH` is 100, so the coordinator
  ceiling binds. Image `ami-07236b80dcdb93bcb`, launch-template v40.
- Staging ASG: min 1 / max 192, two slots per GPU. `vcs-staging-daily-stop` now sets MinSize 0 and
  Desired 0 at 19:00 SGT (a real stop, matching the fixed GPUs); `vcs-staging-daily-start` restores
  MinSize 1 at 07:00 SGT. Evening testing must start a GPU first; an event overrunning 19:00 needs
  its own action or a temporary suspension.

## Queue and Scaling Contract

- Selecting a voice PREPARES it. TTS, Faculty and lecture opening run one preflight: route to a
  resident free slot, else reassign a truly idle worker, else scale.
- Guard 1 (fleet in motion): never scale on selection while any live reassignment, pending boot or
  non-READY worker exists. Per-model short-circuits cannot see a DIFFERENT model transition — the
  blind spot behind the incident.
- Guard 2 (promised worker): a worker already committed to a reassignment is not offered to another
  selection, or concurrent selections all target the same idle-looking GPU and thrash it.
- Guard 3: the 30s anti-thrash grace may DELAY a switch, never justify scaling; if the grace alone
  blocks a reassignment, defer.
- Switching/warming reserves a worker but claims no slot and does not enter the queue.
- One Fast or Full request = one slot; a two-slot GPU runs two and the next matching request queues.
  Occupying the last slot does not itself scale — overflow needs a real queued/rejected request or
  explicit event prewarm.
- Queueing IS distributed: least-loaded matching worker, bounded by `MODEL_MAX_QUEUED_PER_WORKER` (2).
  Past the ceiling, retryable 503 `MODEL_QUEUE_FULL`, scaling only if no boot is already pending.
- A short fleet-wide lease plus request reservations prevents independent Lambdas from selecting the
  same stale snapshot. The lease is released before synthesis; only occupancy remains reserved.
- No GPU has the model: reassign an idle GPU and return retry, or scale if none is safely
  reassignable; the HTTP request is never held through a cold start.
- Routing packs older matching capacity so newer overflow GPUs go idle and scale in. Not round-robin.
- Event mode: minimum resident workers for the event voice cannot be reassigned. Scale-in stays
  independent of model selection.

## Operating Rules

- Read user-level `VCS_AWS_*`, map only to process `AWS_*`, assume the project role, verify account
  identity before AWS writes. Never print or persist credentials.
- Lambda deployment merges tracked environment files into live variables; never replace the map.
- Keep project-memory edits byte-identical between the vault and `docs/Voice Cloning Internship`.
- Preserve unrelated source changes and the user's dirty working tree.

## Next Session

1. Refresh user-level `VCS_AWS_*`, deploy both coordinators/main Lambdas and affected clients from one
   commit, then repeat the six-request three-GPU and super-overflow tests with no idle-capacity scale.
2. Isolate the deployed frontend retry path with a synthesis failure lasting beyond the backend retry
   window; require one answer bubble, automatic speech, and no stale banner or second prompt.
3. Faculty publishing: start the Dev GPU, publish two profiles across two lecture categories, confirm
   Dev and Staging resolve the same pair, then settle the `gi.env` vs lecture-badge contradiction.
4. Open Dev GI after starting its GPU; ask an administrator for CloudTrail attribution and orphan cleanup.

Also open (BUGS.md): the Faculty full-screen "Starting the GPU" modal blocks authoring while capacity
warms. The stale completed-boot marker and Faculty manual-retry problem were fixed and deployed on
2026-09-01.
