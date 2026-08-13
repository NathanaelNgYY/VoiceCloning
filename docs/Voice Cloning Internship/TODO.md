# Active TODO

- [ ] Ask an administrator to terminate stopped standalone verifier canary
  `i-0e4ef8844a120d069`; the internship role is denied termination.
- [ ] Synchronize the rotated `LIVE_AUTH_LOADTEST_SECRET` to the fixed live gateway
  during its next running window. Lambda and LT v26 match and a direct public prime
  returned HTTP 200 RIFF; the fixed gateway stopped before its `.env` could be updated.

- [ ] Reset the deployed chatbot prompt in staging S3 to the bundled default. It
  currently holds a throwaway test prompt, so the GI safety scope is the only thing
  keeping the assistant on-topic.
- [ ] Decide whether the open kiosk should keep unauthenticated access. It is a
  deliberate staging-only choice; the origin check is browser-supplied and therefore
  a soft gate, so treat the gateway and synthesis route as publicly reachable and
  watch spend.

- [ ] Before SSO analytics rollout, validate the access token server-side and enrich
  stored batches with an immutable subject identifier; never accept a browser-claimed
  user ID. Add a Glue/Athena table and supervisor dashboard only after event volume
  and reporting questions justify them; define retention and learner disclosure first.
- [ ] Add a liveness-only health endpoint for the fixed staging SSE progress relay
  and point `vcs-staging-tg-3003` at it; preserve S3 cross-host progress polling and
  verify synthesis still routes only to `vcs-stg-opt-3103`.
- [ ] Repair the worker test suites: the compact-formula inference test leaves a
  nested subtest unfinished, and the email mock fails without configured mail env.

- [ ] Future: evaluate a versioned alias plus scheduled provisioned concurrency only
  if eager 512 MB initialization is still insufficient. Current reruns passed 100/100
  and 150/150. It will not fix GPU admission retries or network/transit outliers.
- [ ] Reduce 150-user first-audio tails. First-turn p95 included 9.75 seconds of
  capacity-retry sleep, while the maximum slept 19.75 seconds across 12 retries.
  Publish occupied/total slots, no-capacity responses, and pending admissions every
  10 seconds; scale on capacity pressure rather than only minute-averaged occupancy.
  Compare shorter jittered retries with a centralized fair queue, requiring bounded
  FIFO waiting and no retry storm/starvation. For a known 150-user simultaneous event,
  prewarm more than the current 50-GPU rehearsal floor and do not depend on reactive
  launch. Test the same three-turn workload as both an immediate burst and a 30-60
  second arrival ramp, reporting p50/p95/max, retries, pending demand, errors, and
  GPU-hours. Separately trace the two requests that spent 9.50-16.55 seconds outside
  Lambda.
- [ ] Before the 2026-08-04 event, re-read LT v20/default, the verified 13:30/16:00
  actions, occupancy alarms/actions, and gateway health. The 13:30 action begins GPU
  launch; it is not an admission-ready timestamp. Run
  `ensure-staging-live-gateway.ps1 -Apply`, then
  `wait-staging-event-ready.ps1 -ExpectedCapacity 50` before users enter. The final
  browser-equivalent keepalive runs completed 100/100 and 150/150 on both 50 and
  fully primed 60 GPUs. Do not use three slots: its warm gate passed only 39/50
  targets. Still run the 60-minute soak and one target-loss rehearsal.
- [ ] Ask an administrator to apply and read back the optional 300-second ALB idle
  timeout with `scripts/set-staging-alb-idle-timeout.ps1 -Apply`; this role is denied
  `elasticloadbalancing:ModifyLoadBalancerAttributes`. Keep the 15-second client/
  harness keepalive regardless.
- [ ] Verify the fixed GPU's 07:00 and 19:00 SGT boundary transitions. Matching ASG
  recurring actions were read back, but the fixed GPU's invoker remains uninspectable.
- [ ] Ask an administrator to grant the staging Lambda execution role
  `autoscaling:DescribeAutoScalingGroups` and `autoscaling:UpdateAutoScalingGroup`
  scoped to `vcs-staging-gpu-inference`, then apply
  `scripts/set-staging-lifecycle-coupling.ps1 -Apply` for manual stop/termination coupling.
- [ ] Rotate the internal voice-profile authentication value across Lambda, the fixed
  worker, and the inference launch image; an older deploy command exposed the current
  value in console output. The deploy script now prints deployment metadata only.
- [ ] Ask an administrator to deregister stopped validator `i-015de451bff24a73b`
  from `vcs-stg-opt-3103` and terminate it, and terminate stopped v15 validator
  `i-0eb2ca68edb88d6d7`; fresh 2026-08-01 attempts confirmed both permissions denied.
- [ ] After the event, prototype durable multi-user training orchestration. Compare a
  queue-backed training ASG/AWS Batch with SageMaker Training Jobs using the same
  v2ProPlus pipeline; require per-job S3 isolation, leases/idempotency, checkpoints,
  cancellation, progress, quotas, cost/startup measurements, and explicit model
  activation before choosing.
- [ ] Improve scale-out detection latency. The live one-minute 70% occupied-slot
  alarm saw 73% at 07:00 but alarmed only at 07:03:48. Build a real fleet-wide custom
  high-resolution occupied/total metric every 10 seconds and test three consecutive
  samples against false scale-outs and GPU-hours; changing the standard metric's
  alarm period alone cannot create 10-second source data.
- [ ] Run a controlled staging A/B for early-sentence voice with comparable
  multi-sentence answers. Record OpenAI first token/text done, TTS start, first audio,
  profile resolution, worker round trip, and p50/p95. The current Node complete-flow
  harness waits for full text, so adapt it or use browser instrumentation; current
  browser checks are functional smoke evidence only.
- [ ] Design a dedicated warm target group/hidden public route. Exercise each exact
  new target through the public stack, then promote it to the production target
  group; current ALB health preceded public-prime completion by about two minutes,
  and a target's public request can be routed to another target.
- [ ] Audit the exact CloudFront TTS behavior/origin before testing a 60-second origin
  response timeout, and benchmark gp3 reads/model phases on one canary before paying
  for Fast Snapshot Restore. Neither change is yet justified as a latency baseline.
- [ ] Make Live Full horizontally correct before increasing its concurrency: add a
  distributed session lease/fencing token, conditional manifest revisions,
  idempotency keys, durable resumable progress, and worker-loss/concurrent-edit tests.
  Evaluate chunk-level parallelism only afterward because it can increase cost and
  produce cross-GPU voice/prosody/loudness inconsistencies.
- [ ] In two signed-in staging browsers, verify one conversation keeps the same exact voice
  revision while another browser loads or overwrites a profile between Fast chunks.

- [ ] Browser-test the deployed Live Full chunk generation library: regenerate one chunk at least three times, listen to every archived take, restore the oldest, and confirm the displaced current take returns to the library while textarea/chunk preview/final playback/download use the restored version without synthesis. Verify histories remain independent across chunks and insert/delete clear them.

- [ ] In the deployed pronunciation UI, save and load `stereochemistry` with synthesis spelling `stereo chemistry`, then compare no-alias vs alias audio in Fast and Full at sentence start/middle/end. Confirm spacing improves clarity without an unnatural pause and inspect ASR/full-span phoneme logs; delete or revise the alias if listening is worse.

- [ ] Browser-test the deployed Live Fast TTS and Fast Queue saved-output gain at -6/0/+3/+6 dB, including saved-config restore and multi-clip queued playback; confirm clipping stays below the -1 dBFS ceiling.

- [ ] Load DeanVoice after the 2026-07-24 worker restart, then listen-label the saved calibration WAVs and extend held-out checks to `glycoprotein`, `glycolipids`, `structural`, and controls at sentence start/middle/end. Compare timestamp vs `speech_end` crop-family logs and measure false approvals before changing any threshold; endpoint crops are deployed, but real-audio performance is not yet verified.
- [ ] Browser-test Full/Queue saved-output gain at -6/0/+3/+6 dB, confirm previews/queued chunks/final download match and stay unclipped, verify best-effort badges/reasons survive initial generation and regeneration, and test leading/trailing/consecutive boundary breaks in Full, Full Queue, Fast TTS, and Fast Queue.

- [ ] Deploy the 2026-07-20 SSML break parity changes to the inference worker and frontend, then browser-listen to `hello <break time="7000ms"/> hello` through Live Fast TTS, Live Fast Queue, initial Live Full generation, and a Live Full sentence regeneration; confirm roughly seven seconds of silence, no spoken markup, and one editable Full review card containing both words plus the break tag.
- [ ] Deploy the ARPAbet-only/global-uniqueness change to Lambda and the inference worker, build/deploy the frontend, then save or import one entry to rewrite all category files without readable-only legacy records.
- [ ] Run one full `v2ProPlus` training pass and verify the new 9-step SSE flow, especially `Extract Speaker Verification`.
- [ ] Verify `training/runs/<expName>/metadata.json` is uploaded to S3 after a real training run.
- [ ] Compare `Skip denoise` enabled vs disabled on clean recordings and record when it actually improves cloned timbre.
- [ ] Validate strict frontend reference filtering and visible scores against `gpu-worker/scripts/score_clips.py` on real clips.
- [ ] Browser-test Live Fast saved config list/load/update/delete/sample generation on a real trained model; confirm the sentence limit defaults to 1, Max chunk words defaults to Auto/280 characters, saved 10–100-word values override the character heuristic and restore, sub-eight-word chunks absorb at most one neighbour within the hard limit, and all three phoneme-rejected takes re-seed before best-effort output.
- [ ] Browser-test Live Full metadata-only defaulting, save/load/update/delete/sample, and Full Inference generation using Live Fast rank #1 refs on a real trained model.
- [ ] Browser-test Live Full/Queue on a real GPU: verify 3→5 retries and per-sentence best-effort never abort on an audio-usable take, timing+waveform-forgiven technical words are actually audible, revised text persists in the wider editor, normalized previews/full WAV refresh, dropdown/model-ready state does not flap, warm GPU return bypasses the slow overlay, two concurrent browsers receive 409, and an abandoned session does not leave a false another-user banner.
- [ ] Deploy the scoped three-outcome phoneme verifier plus the Live Fast integration, then on the real GPU listen-test Whisper-mismatched and explicitly strict ARPAbet terms in both Fast and Full. Calibrate pass thresholds (`PHONEME_MIN_CTC_LOG_PROB`, `PHONEME_MIN_SIMILARITY`), conservative reject thresholds, and crop paddings from structured `[phoneme]` logs; also verify completed/regenerated WAVs no longer hit the metadata-readiness retry limit. Model download/token validation and a CUDA forward-pass smoke test are complete (1263.3 MiB peak on L4).
- [ ] Deploy and browser-test Live Full's hard 170-character Auto boundary, two-sentence target, fit-bounded short-context exception, safe oversized-sentence continuation, and per-chunk insert/delete actions; use the Opus/Sol/Terra script to confirm newlines/numbers/acronyms do not create heading-only cards, insert chunks at the start/middle/end, delete a middle chunk, and confirm every rebuilt/downloaded WAV, review index, preview, and S3 result is correct.
- [ ] Browser-test Live Full chatbot queued replies with a real microphone/WebSocket/GPU reply and verify each phrase uses Live Full route/config while the first completed phrase plays immediately.
- [ ] Decide whether generated config sample WAVs should be uploaded and persisted, instead of only saving sample metadata.
- [ ] Reconcile current deployment/source-of-truth docs now that older handoff files were renamed with `(Outdated)`.
- [ ] Decide whether repo-managed deployment should also check in `gpu-worker.service` and `live-gateway.service`; only `systemd/gpu-inference-worker.service` is currently present in the repo.
