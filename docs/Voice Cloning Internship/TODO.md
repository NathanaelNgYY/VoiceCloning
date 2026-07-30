# Active TODO

- [ ] Before 2026-08-02 07:15 SGT, finish staging fleet rollout: immutable
  per-session voices, shared Full state, bounded queues, two tested same-model slots per
  GPU, GI chatbot UI, Target Optimizer, final AMI/launch template, ASG, one fresh
  instance, rule-3 cutover, max-192 ceiling, and paired 50-GPU 07:15/18:00 SGT
  actions are complete and verified live.
  Corrected route-warm testing passed 50/50 on 32 GPUs; the 100-user run completed
  first-turn voice for 100/100 and all three turns for 98/100. True zero-capacity
  scaling 32->51 and a hot 51-GPU 100/100 three-turn flow are verified. The 2026-07-30
  50-GPU rehearsals remain unreliable: v14 completed 68/100 immediately after warm
  and 144/150 when hot. The fixed +10 policy scaled 50->60, and route-warmed 60
  passed 150/150 once; earlier 80 also passed 150/150. Decide whether to raise event
  prewarm above 50, push local commits, then run the 60-minute soak and one target
  termination rehearsal.
- [ ] Ask an administrator to deregister stopped validator `i-015de451bff24a73b`
  from `vcs-stg-opt-3103` and terminate it; this role is denied both actions.
- [ ] After the event, prototype durable multi-user training orchestration. Compare a
  queue-backed training ASG/AWS Batch with SageMaker Training Jobs using the same
  v2ProPlus pipeline; require per-job S3 isolation, leases/idempotency, checkpoints,
  cancellation, progress, quotas, cost/startup measurements, and explicit model
  activation before choosing.
- [ ] Rehearse proactive inference scaling with a fleet-wide high-resolution metric:
  publish occupied/total synthesis slots every 10 seconds and try 50-75% utilization
  for three consecutive samples, a scale-out cooldown, and slow scale-in. Compare
  first-audio latency, rejected requests, false scale-outs, and GPU-hours before
  comparing against the planned one-minute rejection alarm; use 10-30 busy GPUs only as an
  optional minimum guard, not the primary threshold.
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
