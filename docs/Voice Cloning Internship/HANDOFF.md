# Voice Cloning Project Handoff

Last updated: 2026-08-31

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
- ElevenLabs stock voices bypass the cloned-voice coordinator entirely: selecting one must take no
  slot and must not evict the resident cloned voice. Asserted by design, not yet exercised.

## 2026-08-31 Autoscaling Incident (resolved)

- One person's model selections drove desired 1->2->3->4: selection preflight could scale and could
  not see a switch already in progress for a different model. Guards 1-3 below close it. The first
  fix banned selection-time scaling entirely and is SUPERSEDED as over-broad — it disabled real
  preparation, and its "load on demand" notice was the confusing frontend message.
- The 02:09 UTC replacement launches were NOT load scaling: instances were explicitly stopped and
  replaced. That churn is still unattributed — see BUGS.md.
- Full narrative and evidence: CHANGELOG, 2026-08-31 entries.

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

IMPLEMENTED BUT NEVER EXERCISED — do not call these working:

- Distributed queueing across 3+ GPUs. The fleet has only ever been 1-2 GPUs. Least-loaded choice is
  correct by inspection — but so was the race path that proved broken.
- The 2-queued-per-GPU ceiling, `MODEL_QUEUE_FULL` retry, large-burst redistribution; Live Full as
  one slot (only Live Fast exercised); interrupted mid-inference requests.
- ElevenLabs taking no slot. The busy marker is confirmed real by inspection, but no stock-voice
  request has been run.
- Faculty publishing and its Dev/Staging mirroring.
- Scale-in preferring the newest/idlest GPU; only a 2 -> 1 has been seen, which cannot distinguish it.

CONTRADICTION: the lecture badge showed `cs-nathanael-ng` while `client/env/staging/gi.env` pins
`deanvoice-v1`. Settle which wins after a faculty publish.

## Deployment State

- Deployed 2026-08-31: both main Lambdas, both coordinators, Dev/Staging TTS/Faculty and GI bundles.
- Tests at head: Lambda 324/324, coordinator 43/43, client 491/491. `lambda/model-coordinator` needs
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
- A request losing the slot race falls back to that worker's waiting list when it has room — the
  COMMON path for the third caller in a burst, which previously skipped the queue entirely.
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

1. Distributed queueing at scale. Take Staging to 3-4 GPUs on one voice, fire ~10-15 concurrent
   requests, prove waiting lists spread rather than stack, the 2-per-GPU ceiling holds, overflow
   returns retryable `MODEL_QUEUE_FULL` without one scale per request, and capacity returns to
   baseline. Largest untested area; costs real GPU time, so agree the spend first.
2. Live Full and interruption: confirm one Full request takes one slot, and decide what should happen
   when a user interrupts mid-inference — that behaviour is unknown, not merely unverified.
3. ElevenLabs bypass: run a stock-voice request; confirm no slot, no busy marker, no eviction.
4. Faculty publishing: start the Dev GPU, publish two profiles across two lecture categories, confirm
   Dev and Staging resolve the same pair, then settle the `gi.env` vs lecture-badge contradiction.
5. Dev GI lecture surface — never opened in a browser; its GPU is stopped and must be started.
6. Ask an administrator for `cloudtrail:LookupEvents` to finish the ASG churn trace, and to clear the
   orphaned snapshot and stopped canaries in TODO.md.

Also open (BUGS.md): the Faculty full-screen "Starting the GPU" modal blocks authoring while capacity
warms, and a `PENDING` marker is not cleared when its GPU arrives, so "another GPU is starting"
persists for the 10-minute TTL after the voice is ready.
