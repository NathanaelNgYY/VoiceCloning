# Voice Cloning Project Handoff

Last updated: 2026-08-31

## Current State

- Dev and Staging use one application tree. Dev branch `separate-containers-new` and Staging
  branch `codex/staging-multi-user-scaling` must point to the same reviewed commit; runtime
  configuration owns the deliberate differences.
- Dev has two fixed inference GPUs behind the coordinator. The original GPU remains activity-managed
  with a 30-minute idle stop; the comparison GPU is manual-only. Dev coordinator is routing-only:
  it routes, reassigns, and queues like Staging but only simulates scale decisions.
- Staging owns the inference ASG (min 1, max 192, two synthesis slots per GPU). Faculty is the sole
  authoring surface. Publishing mirrors only the selected immutable cloned-voice snapshot and category
  to Dev; training runs, analytics, transcripts, and other state stay isolated.
- ElevenLabs stock voices bypass the cloned-voice GPU coordinator. Selecting a stock voice must not
  load it onto a GPU or evict the resident cloned voice.

## 2026-08-31 Autoscaling Incident

- Verified root cause: `/models/select` and lecture `/voice-profile/capacity` preflight could call
  the coordinator's scale operation. While one GPU was draining/warming another model, the next
  selection saw no eligible worker and increased desired capacity. AWS recorded direct desired changes
  1->2, 2->3, and later 3->4 even though this was one-person model-selection activity.
- SUPERSEDED 2026-08-31 (later). The original fix banned selection-time scaling outright and returned
  `ON_DEMAND`. That was over-broad: it also stopped legitimate preparation, and the `ON_DEMAND` notice
  was the confusing frontend message. Selection now scales again, blocked only while the fleet is
  already in motion — see Guards 1 and 2 in the Queue and Scaling Contract.
- Live proof after deployment: sequential Dean, Alex, and cs-nathanael selections returned
  `READY`, `WARMING/reassign`, and `ON_DEMAND`. ASG desired stayed 4 before and after.
- Structured coordinator logs now record prepare/synthesis source and decisions: route, queue,
  reassign, on-demand, post-admission scale, and queue-timeout scale.
- Separate ASG replacement launches at 02:09 UTC were not inferred load scaling. Several instances
  were explicitly stopped at the same timestamp (`Client.UserInitiatedShutdown`), so the ASG
  replaced them to maintain desired capacity.
- Worker reassignment no longer throws `Inference server is already running` merely because the
  managed Python process missed a two-second readiness probe while applying weights. A live managed
  process is reused and the real downstream request timeout reports genuine failures.
- Later signed-in testing exposed a second regression. Live logs proved two requests filled the sole
  worker's two slots, then speculative post-admission checks directly changed desired 1->2->3.
  The first pending boot was also cleared by the old matching worker before a new worker existed.
- Dev's false “GPU starting” notice was cross-environment leakage: both coordinators shared unscoped
  pending/reassignment records. Opposing lecture polls also switched one idle worker repeatedly because
  preparation grace was zero. These three corrections are local at the current branch head only:
  scoped records, no direct-admission overflow, correct boot ownership, and 30-second preflight grace.

## Deployment Evidence and Limits

- Dev and Staging main Lambdas/coordinators and the Dev/Staging TTS, GI, and Staging Faculty bundles
  were deployed on 2026-08-31. Public readback returned TTS `DFWQ-Hnh`/`D4Nofi_u`, Faculty
  `CwYdV_vL`, and both GI sites `Z4F7ReUL`.
- Superseded 2026-08-31 (later): dropdown selection on TTS/Faculty is no longer metadata-only. It now
  prepares capacity exactly like opening a lecture. See the Queue and Scaling Contract below.
- Event mode has a coordinator residency-minimum lock. The oldest required workers for the event
  voice cannot be reassigned; excess workers remain reusable. A live lock-one/status/unlock check
  protected exactly one Dean worker and created no GPU.
- The deploy script previously updated coordinator environment only. It now packages/uploads the
  coordinator ZIP and waits for the code update; live lock actions proved the corrected deployment.
- Corrected worker files were hash-matched on an idle READY Staging worker, baked as
  `ami-07236b80dcdb93bcb`, and promoted to launch-template v40. One canary reached coordinator READY;
  the 15-minute no-traffic policy then naturally returned desired 2->1. The earlier 4->3->2->1
  sequence is also recorded as successful scale-in activity.
- Original Dev GPU `i-03f258d470a2fa73f` was isolated from the manual comparison worker, prepared
  Dean, and returned a 183,084-byte RIFF. Staging direct coordination returned a 129,324-byte RIFF.
- Automated evidence: Lambda 309/309, client 491/491, worker 259/259, affected builds, PowerShell
  parsing, public bundle readback, and live AWS checks. The in-app browser bridge failed before page
  control, so authenticated Faculty publishing and a real two-user burst remain unverified.
- 2026-08-31 (later): both main Lambdas, both coordinators, and the Dev/Staging `live-fast`
  (TTS/Faculty) bundles are deployed. Tests Lambda 322/322, coordinator 41/41, client 491/491.
  Live staging proof at desired capacity 1 throughout: deanvoice selection on an idle cs-nathanael
  GPU returned `WARMING`/`reassign` `started=true` and the GPU settled READY on deanvoice; two
  alexv1 selections during that switch returned `started=false` with the "already being prepared"
  message. No browser flow, real concurrent-synthesis overflow, or `MODEL_QUEUE_FULL` retry has been
  exercised yet — treat those as unverified.

## Queue and Scaling Contract

- Selecting a voice PREPARES it. TTS, Faculty, and lecture opening all run the same preflight: route
  to a resident free slot, else reassign a truly idle worker, else scale. Selection-time scaling is
  deliberate and was re-enabled on 2026-08-31 after the two guards below made it safe.
- Guard 1: a selection never scales while the fleet is already in motion for anyone — any live
  reassignment, any pending boot, or any non-READY worker. It returns `WARMING` with "GPU capacity is
  already being prepared". The per-model short-circuits cannot see a transition for a DIFFERENT model,
  and that blind spot is what caused the 1->2->3->4 incident.
- Guard 2: a worker already promised to a live reassignment is not offered to any other selection.
  Workers stay idle READY until the switch begins, so without this, concurrent selections all target
  the same GPU and thrash it through several models.
- Model switching/warming reserves a worker for preparation but claims no synthesis slot and does
  not enter the TTS queue.
- A real synthesis first routes to a ready exact-model free slot. If all exact-model slots are busy,
  the bounded worker priority/FIFO queue may hold the short wait while Staging prepares overflow.
- Occupying the final free slot does not itself scale. Overflow preparation begins only after an
  actual queued/rejected request (or explicit event prewarm), preventing two users on two slots from
  purchasing unused GPUs. Shared-table coordination records are scoped to Dev or Staging.
- If no GPU has the model, synthesis reassigns an idle GPU and returns preparation/retry, or asks
  Staging to scale when none is safely reassignable. The HTTP request is not held through a multi-minute
  cold start.
- One Full or Fast synthesis request consumes one slot, not two. A two-slot GPU can run two requests;
  the next exact-model request queues. Queueing IS distributed: the least-loaded matching worker is
  chosen, bounded by `MODEL_MAX_QUEUED_PER_WORKER` (2). Past that ceiling `synthesize` returns
  retryable 503 `MODEL_QUEUE_FULL`, and scales only if no boot is already pending — the first overflow
  request has already asked for capacity. The worker's own `SYNTHESIS_MAX_QUEUE_DEPTH` is 100, so the
  coordinator ceiling is the real bound. (An earlier handoff line claiming queueing was not
  distributed was simply wrong about the code.)
- Routing deliberately packs existing/older exact-model capacity so a newer unused overflow GPU can
  become idle and scale down. It is not round-robin.
- During event mode, the configured minimum resident workers for the event voice are unavailable to
  other-model reassignment. Workers above that minimum follow ordinary routing and scale-in rules.
- Scale-in remains independent of model selection: idle overflow workers drain and terminate under
  the Staging quiet-window/cooldown policy; the baseline remains.

## Operating Rules

- Read user-level `VCS_AWS_*`, map them only to process `AWS_*`, assume the project role, and verify
  account identity before AWS writes. Never print or persist credentials.
- Lambda deployment merges tracked environment files into live variables; never replace the complete
  live environment map.
- Keep project-memory edits byte-identical between the primary vault and
  `docs/Voice Cloning Internship`.
- Preserve unrelated server-side/source changes and the user's dirty working tree.

## Next Session

1. Browser-test all four surfaces signed in (Dev TTS, Dev GI, Staging lectures, Staging Faculty):
   selecting a voice/lecture should now show "preparing"/"already being prepared" rather than the old
   load-on-demand notice, and the warning must clear when the GPU is ready.
2. Prove the overflow contract with real concurrent synthesis: two requests fill one GPU's two slots
   without scaling; a third queues on the least-loaded matching GPU and prepares exactly one overflow
   GPU; past two queued per GPU the caller gets retryable `MODEL_QUEUE_FULL` and no second scale.
3. Verify ElevenLabs stock voices take no slot and never mark a GPU busy, and that Dev's `SIMULATED`
   message appears once both Dev GPUs are occupied (needs the manual second Dev GPU started).
4. Run authenticated Faculty -> Staging lecture -> Dev lecture publishing with two cloned profiles.
5. Revoke the temporary credentials exposed during prior debugging and remove the orphaned snapshot
   when an administrator is available.
