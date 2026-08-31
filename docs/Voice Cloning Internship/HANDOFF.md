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

## Deployment Evidence and Limits

- Dev and Staging main Lambdas and coordinators were deployed on 2026-08-31. Both coordinator
  packages have code SHA `OLEIMPMl...rPao=`.
- All four then-current Staging ASG workers received the worker runtime fix and reported
  coordinator-ready. The manual Dev comparison worker also reported ready.
- The original activity-managed Dev worker received the file/restart command but did not report
  model-ready before the local wait was stopped; its final state is unverified.
- The current Staging launch-template AMI does not yet contain this worker runtime change. Bake and
  promote a verified worker after credentials are refreshed, or later scale-outs will use the old file.
- Client source/builds are complete, but Dev/Staging TTS, GI, and Faculty bundles were not deployed
  in this final pass because the user-level safe AWS session expired. Existing live clients still use
  the deployed API behavior; new `ON_DEMAND`/Dev simulation wording awaits client deployment.
- Automated evidence: Lambda 302/302, client 489/489, worker 259/259, Live Fast/chatbot/GI builds,
  and `git diff --check` pass. Authenticated Faculty publishing and a real multi-user scale test
  remain unverified.

## Queue and Scaling Contract

- Model switching/warming reserves a worker for preparation but claims no synthesis slot and does
  not enter the TTS queue.
- A real synthesis first routes to a ready exact-model free slot. If all exact-model slots are busy,
  the bounded worker priority/FIFO queue may hold the short wait while Staging prepares overflow.
- If no GPU has the model, synthesis reassigns an idle GPU and returns preparation/retry, or asks
  Staging to scale when none is safely reassignable. The HTTP request is not held through a multi-minute
  cold start.
- One Full or Fast synthesis request consumes one slot, not two. A two-slot GPU can run two requests;
  the next exact-model request queues. Queueing is per matching worker, not globally even distribution.
- Routing deliberately packs existing/older exact-model capacity so a newer unused overflow GPU can
  become idle and scale down. It is not round-robin.
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

1. Refresh the safe user-level AWS session.
2. Inspect the original Dev worker; verify coordinator status and a real Dean synthesis.
3. Deploy Dev/Staging TTS and GI plus Staging Faculty client bundles; verify public asset hashes.
4. Bake the corrected Staging worker into a new AMI/launch-template version and canary one scale-out.
5. Let excess Staging capacity scale down naturally; confirm selection alone never changes desired.
6. Run authenticated Faculty -> Staging lecture -> Dev lecture publishing with two cloned profiles.
7. Run a controlled two-user same-model and different-model test; capture route, queue, scale, and
   scale-down decision logs.
8. Revoke any temporary credentials exposed during prior debugging and remove the orphaned snapshot
   when an administrator is available.
