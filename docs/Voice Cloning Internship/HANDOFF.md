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
- Fixed policy: selection and page preflight may route an exact resident model or reassign one truly
  idle worker, but cannot increase ASG desired capacity. If no worker is immediately eligible, Staging
  returns `ON_DEMAND`; the first real synthesis request may then reassign or scale. Explicit event
  prewarm may opt into scaling.
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
- Dropdown selection on TTS/Faculty is now metadata-only: it resolves and pins immutable model and
  reference data but does not prepare, switch, queue, or scale a GPU. First synthesis owns admission.
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
- Regression-fix evidence is local only: coordinator 31/31, Lambda 312/312, package build, and live
  read-only AWS attribution. Do not describe the corrected behavior as deployed until both coordinator
  functions are updated and a signed-in two-user/third-request test passes.

## Queue and Scaling Contract

- TTS and Faculty voice selection is metadata-only. Lecture opening may preflight existing capacity
  with scaling disabled; it can reuse/reassign an idle worker but cannot purchase a GPU.
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
  the next exact-model request queues. Queueing is per matching worker, not globally even distribution.
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

1. Deploy both coordinator functions from the local regression fix; do not deploy clients/workers.
2. Run controlled two-user same/different-model tests plus one real third request; capture route,
   queue, exactly-one-scale, Dev isolation, anti-thrash, and natural scale-down evidence.
3. Run authenticated Faculty -> Staging lecture -> Dev lecture publishing with two cloned profiles.
4. Revoke any temporary credentials exposed during prior debugging and remove the orphaned snapshot
   when an administrator is available.
