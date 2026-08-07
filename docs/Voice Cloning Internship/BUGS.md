# Bugs

## Active

- 2026-08-03: staging fixed inference and ASG AMI `ami-021aeb72894b8c79b`
  lack `resemblyzer`, so speaker-identity scoring degrades to ASR/audio-quality checks.
  History shows the gate was added intentionally; no evidence supports removal as a
  fleet-wide latency optimization. Do not confuse this with the deliberate first-live-
  clip `skip_verify` path. Bake and benchmark the dependency in a canary AMI.
- 2026-08-03: staging `/inference/progress/*` uses the fixed port-3003 target while
  its inference-readiness health check is 503. S3-backed SSE currently works through
  ALB fail-open and synthesis remains on the ASG, but health is misleading and loss
  of the fixed relay can interrupt progress. Add a relay-liveness health check.
- 2026-08-03: the full inference-worker suite has one cancelled nested subtest in
  the compact-chemical-formula case, and the training-worker suite has one email mock
  failure when mail env is absent. Lambda, gateway, and client suites pass; deployed
  worker/public health passes. Do not call the full local worker test matrix green.

- 2026-07-31: the final 150-user run passed every session, but its first-turn p95 was
  dominated by capacity backoff: 9.75 seconds retry sleep at p95 and 19.75 seconds in
  the maximum. Two later requests separately spent 9.50-16.55 seconds outside Lambda
  despite 1.47-2.17 second worker times. Track admission pressure and transit tails as
  separate issues; neither is a Lambda cold-start/profile-resolution regression.

- 2026-07-31: one of 150 pre-scale keepalive sessions produced no completed turn and
  timed out after 720 seconds; the other 149 completed all three turns and all
  post-scale 150 sessions completed. Keepalive prevents idle 1006 collapse but does
  not guarantee a stalled OpenAI/gateway turn will complete. Preserve timeout/error
  instrumentation and reproduce under a soak before calling this resolved.
- 2026-07-31: ALB target health precedes strict public-prime completion. During
  reactive 50->60, all targets were healthy at 07:09:27 but public-prime logs
  completed through 07:11:30. Public requests from a node can also route to another
  target. Strict per-target public readiness needs a dedicated warm target group/path.
- 2026-07-31: worker restarts could leave the boot-time public-prime log marker in
  place, allowing readiness to accept stale evidence. The readiness probe now fails
  closed unless the prime log is at least as new as the current worker start.
- 2026-07-31: setting `GPU_SCHEDULE_ENABLED=true` enables the staging Lambda's
  07:00-23:00 Singapore decision logic, and a direct in-window idle-check invocation
  returned `in-window-running`. CloudWatch later showed exactly one Lambda invocation
  every five minutes, including quiet hours, proving an automatic invoker exists.
  This role cannot list its resource; the exact boundary transition remains unverified.
- 2026-07-29: the corrected real-route warm made the 32-GPU/50-user chatbot flow pass
  50/50, but a 100-user three-turn run completed 98/100 sessions; two WebSockets closed
  with code 1006 after turn 1. A separate 128-user sustained TTS run produced 34
  CloudFront 504s near 30 seconds and one 503 while the strict capacity rule retained
  one sampled free slot. The 51-GPU hot run passed 100/100. Choose event capacity and
  decide whether to remove the public 30-second timeout exposure.

## Recently Fixed

- 2026-08-07: GI previously compared its configured Dean voice against shared `active.json`, so a
  TTS/training user activating another profile blocked GI. Dev and staging now load saved
  `deanvoice-v1` directly through an authenticated read-only route and pin its snapshot without
  changing global active state. Live unsigned route checks return 401; signed-in audio remains a
  manual browser/listening check.
- 2026-08-07: dev GI Microsoft sign-in created learner profiles and authenticated the
  WebSocket, but cloned-voice REST calls omitted the bearer token and returned 401. The shared
  API client now attaches the configured token. Voice auth is required only for GI-tagged
  CloudFront requests, preserving public dev TTS/Training/Dean access; analytics and supervisor
  routes remain independently authenticated.

- 2026-07-31: fixed the 4.618-second first Live lazy import by eagerly loading Live at
  512 MB. GI now sends the pinned GPT/SoVITS snapshot, reducing its synthesis-time
  profile resolution to 0 ms p50. ID-only callers still resolve normally, and regular
  Live Fast/Full retains its existing selected-model snapshot behavior. GPU-free first
  invocation is 15.71 ms; 100/150 three-turn reruns passed.

- 2026-07-31: the 15-minute quiet alarm used missing-data-as-breaching, so it entered
  ALARM without a numeric datapoint and Step Scaling never applied `-1`; five GPUs
  remained running for almost an hour. The alarm now evaluates
  `FILL(TargetControlRequestCount,0) < 1`. A controlled desired-3 run proved 3->2
  and 2->1 while retaining the min-1 floor.
- 2026-07-31: Live Fast phrase replies always waited for `assistant.text.done` before
  starting TTS. Staging now begins after the first confirmed complete streamed
  sentence for multi-sentence replies. A deployed browser completed cloned playback,
  but population-level latency improvement is not yet measured.
- 2026-07-31: the load harness omitted the browser's 15-second WebSocket keepalive.
  Long-answer controls completed only 33/100 and 13/150 with code 1006. With the
  keepalive, 50-GPU runs completed 100/100 and 150/150, and fully primed 60-GPU
  comparisons also completed 100%. Live ALB idle timeout remains 60 seconds because
  this role is denied the optional 300-second attribute change.
- 2026-07-31: event readiness checked SSM invocations once before command distribution
  completed, producing false 0/50 and 49/50 summaries. It now retries pending
  invocations; the final gates passed 50/50 and 60/60.

- 2026-07-31: baseline occupancy previously could make two overlapping requests scale
  a one-GPU fleet directly to 11. Below five healthy GPUs, the 70% alarm now sets
  exact capacity five; the separate fleet alarm keeps +10 increments from five onward.
- 2026-07-31: three slots per GPU failed its mandatory rollout gate: only 39/50
  targets completed ten concurrent rounds. It was not user-load-tested or promoted;
  two slots were restored and passed 50/50.

- 2026-07-30: local warm and target health did not make a fresh event fleet public-
  burst ready. Stable v16 completed only 48/100; Lambda init averaged 126.7ms while
  synthesis duration p95/max reached 30.36/37.89s and Target Optimizer rejected 21.
  A realistic public prime absorbed the cold work, after which full flow passed
  100/100. LT v17 now automates two public first-clip primes per new instance plus
  backend settle; the fresh 50-GPU v17 acceptance run completed 100/100.
- 2026-07-30: first-boot `unattended-upgrade` restarted the warmed v15 inference and
  Target Optimizer services, leaving Node listening with model readiness false and
  causing ALB 503 churn. v16/v17 mask automatic-update units and gate every worker
  restart on the full warm before Target Optimizer can start.
- 2026-07-29: completed-request target tracking could scale from small sustained
  traffic even while optimizer capacity was free. Scale-out now requires a sampled
  zero-capacity minute plus rejected traffic; 100 and 128 sequential users correctly
  did not scale with two/one free slots, while 192 users triggered 32->51. The legacy
  target policy is neutralized because the role cannot delete it.

- 2026-07-29: ASG target tracking allowed min/desired zero, but
  `ALBRequestCountPerTarget` cannot scale out when no targets exist. A validation
  scale-in terminated every target. The live ASG and repo default now keep one
  baseline instance.

- 2026-07-29: launch-template v9 referenced a no-reboot AMI that captured
  `gpu-inference-worker/src/index.js` as zero bytes. It was rolled back to v8; the
  source file was verified at 3,577 bytes and the filesystem synced before final
  AMI `ami-02e0a90f76ed1ce2a` was validated. Launch-template v11 additionally gates
  Target Optimizer startup on the completed warm synthesis.

- 2026-07-29: a true cold ASG boot could exceed the inference worker's 120-second
  startup timeout. The timed-out Python child was forgotten but left alive, so a retry
  launched a second API process and readiness flapped. Timed-out children are now
  killed, late exits cannot clear a newer process, and cold startup has a five-minute
  window. A fresh AMI instance produced valid DeanVoice audio with one API process.

- 2026-07-28: freezing only a `voiceProfileId` left a cross-chunk edge case: editing
  that same S3 profile record during a Live Fast conversation could make a later chunk
  resolve newer weights/references. Conversations now carry the exact GPT/SoVITS refs,
  reference set, and revision; Lambda accepts that pinned snapshot without rereading
  mutable profile state. Code/tests are pushed; staging deployment is pending.

- 2026-07-28: staging CloudFront globally converted S3/API 404s to `index.html` with
  status 200, so a missing voice profile looked like successful audio. The three
  staging distributions now rewrite only frontend routes on the default static
  behavior; API errors retain their real status/content type.

- 2026-07-28: concurrent users could change the process-global model/voice during
  another request, bypass the lock through demo paths, or lose Full session ownership
  when ALB routing changed target. Requests/conversations now freeze voice identity,
  all inference/model mutations use one bounded model-aware scheduler, and Full session
  state/events/artifacts/cancellation are shared through S3.

- 2026-07-27: Live Full regeneration did not actually pass the helper's `preserveReviewUnit` flag, despite the implementation comment and helper-level test, so edited cards could be internally re-chunked. Regeneration now forces one synthesis unit, and mutable worker WAV routes disable caching to prevent an older overwritten take from being reused. Targeted tests pass; the supplied-name WAV was unavailable locally and real browser listening remains unverified.

- 2026-07-24: pronunciation CSV imports lowercased header names but compared them with camel-case `verifyPhonemes`, silently dropping strict flags; the new `synthesisAlias` header would have failed the same way. Known headers now canonicalize before parsing, and round-trip tests cover both fields.

- 2026-07-24: Full formula preprocessing treated standalone valid element-symbol words such as sentence-initial `In` as chemical notation and rendered their letters individually. Alphabetic formulas now require multiple element symbols unless digits/grouping provide explicit formula evidence. Terminal phoneme approval also no longer relies on multiple correlated paddings of one Whisper span: it requires agreement with speech-end-anchored crops. Automated and deployment checks pass; real listening-labelled false-approval performance remains unverified.

- 2026-07-22: Production phoneme verification mapped every `ER` to unsupported IPA `ɝ` and discarded stress before mapping `AH`, so strict words such as `structural` could only return `uncertain`. ARPAbet conversion now maps `ER0`/stressed ER and `AH0`/stressed AH distinctly using tokens supported by the deployed wav2vec2 tokenizer. Real DeanVoice start-position checks now produce CTC/similarity scores and pass. Also reconciled exact normalized split compounds such as expected `through out` with Whisper `throughout`, removing false missing-word retries. Terminal word timing can still overlap a preceding word and remains open.

- 2026-07-22: A `<break>` before the first spoken word was discarded and a break after the final word could not become a WAV gap because joining only inserted silence between audio buffers. Full and Fast now separate boundary breaks from internal breaks and prepend/append exact WAV silence; consecutive boundary breaks add up to the existing 10-second cap. Unit coverage passes, but deployment and real browser listening remain.

- 2026-07-20: Live Full targeted regeneration expanded `<break>` into an internal marker and then stripped that marker before synthesis, while initial Full exposed both sides as separate review cards; Live Fast skipped SSML expansion entirely and browser Fast chunking could strand a break at a separate WAV boundary. Full now keeps the break inside one parent review chunk selected by ordinary context/chunk rules, uses it only for internal verified audio splitting/joining, and preserves editable markup. Fast applies its established per-segment verification then exact-silence joining, and the browser keeps both sides together. Deployment and real audio verification remain.
- 2026-07-14: Live Full could emit one sentence per chunk even with `Max sentences / chunk = 2` because a 60%-of-size heuristic flushed the first sentence before evaluating whether the second fit. Removed the premature flush; sentence count and character/word limits now determine grouping, with one bounded extra sentence when the result has fewer than eight words. Dotted and spaced initialisms now share deterministic spoken letter-name normalization, including `A` and `I`; a dotted initialism's last period is preserved when it also marks a sentence boundary instead of accidentally fusing the next sentence.
- 2026-07-14: pronunciation categories were separate S3 files but runtime concatenated them, allowing the same word to compete across categories; readable-only records could also rewrite verifier text (`iron` → `eye urn`) and falsely report a correctly transcribed word as missing. Fixed in pushed commit `73dfde0` by making entries ARPAbet-only, enforcing global replacement/deletion across categories, hiding and cleaning legacy duplicates, and defensively deduplicating/ignoring readable records in the worker. Deployment is pending.
- 2026-07-14: dev Full quality silently lacked speaker-similarity verification because `resemblyzer` was absent from the systemd service's Conda environment. Installed `resemblyzer 0.1.4`; the sidecar now reports active at the configured `0.62` threshold after restart.
- 2026-07-14: the first phoneme gate checked all 3,683 saved ARPAbet entries, so ordinary words such as `parameters` could reject otherwise clean `coverage=100%` takes. Fixed in pushed commit `1aea2c1` by checking Whisper-missed/mistranscribed dictionary terms by default and requiring explicit `verifyPhonemes` opt-in for correctly transcribed strict terms. Three overlapping crops produce `pass`/`reject`/`uncertain`; uncertainty cannot forgive a mismatch or hard-reject a strict word. Fast remains unchanged. Deployment is pending.
- 2026-07-14: newly completed/regenerated audio could show `Audio metadata was not ready yet` because the browser issued a metadata/range probe while the final WAV was still being written or exposed. Playback readiness now retries a cache-busted full-WAV fetch, rejects incomplete files, verifies the local blob's metadata, and retains a CORS-safe native-audio fallback.
- 2026-07-14: a plausible Whisper timestamp alone could falsely “prove” a hard dictionary word was present even if the timestamp covered silence or borrowed a neighboring word's speech. Full forgiveness now requires the exact anchored token slot plus sufficient timestamp duration/confidence and real PCM energy within that same span; silence/absent/short spans remain rejected.
- 2026-07-14: strict Full aborted the entire request after five one-sentence takes when Whisper repeatedly failed to transcribe a technical word such as `Michaelis`. Terminal per-sentence best-effort is restored after 3→5 retries, including ASR-unavailable runs. Technical dictionary mismatches can pass normally only when anchored timestamps show a real sufficiently long/confident token in the expected slot; an actually absent slot remains a rejection during retries.
- 2026-07-14: Full still exempted one-letter words from coverage/timing scrutiny. Full now counts every alphabetic word and applies zero length-based cut exemption during its 3→5 acceptance ladder; after those retries, the later terminal best-effort decision intentionally prioritizes returning the strongest audio-usable full sentence. Fast behavior is unchanged.
- 2026-07-14: stale `waiting`/`generating` progress could show another-user contention with no live request; voice-switch races could briefly show `No model` or apply an older model response; returning to an already-ready GPU paid the full blocking status delay. Ownership now comes from live Fast/Full activity, model loads are selection-versioned with a transient not-ready confirmation, and recent GPU-ready status restores immediately while background status checks run faster/in parallel.
- 2026-07-14: Full failed every take with `covered 0% (voice verification unavailable)` when the optional speaker-similarity sidecar was down. The fail-closed rule incorrectly treated an unavailable identity scorer as proof of incomplete audio. Full now retains strict ASR completeness validation and ranks without similarity until the speaker sidecar returns; only unavailable accurate ASR remains fatal.
- 2026-07-14: Live Full could still choose the first merely acceptable take and leave uncertain pronunciations/voice quality on the table. Full/Queue now rank verified candidates, isolate risky sentences, use beam-5 accurate ASR, and hard-reject low-confidence/dictionary mismatches during normal acceptance. Accurate ASR fails closed if unavailable; speaker similarity is used whenever available. Live Fast is intentionally unchanged.
- 2026-07-14: Live Full/Queue could publish whole missing spans and unclear/mispronounced words even though Whisper visibly rejected them. Root cause: after all strict retries failed, `synthesizeChunkResilient` deliberately returned the highest-scoring rejected take. Full/Queue now hard-fail that chunk before final/queued playback; an explicit legacy best-effort option remains for non-Full callers.
- 2026-07-14: concurrent Fast/Full users could collide in the shared inference process, and worker 409 responses were flattened to Lambda 500/generic browser failures. The worker now tracks Live Fast ownership alongside Full session state, both Lambda synthesis routes preserve upstream status codes, and the TTS UI distinguishes contention (409), expired sessions (404), and transient gateway timeouts.
- 2026-06-30: Full Inference skipped "divide very fast" while logs showed `missing=[divide, very, fast]` and `dictForgiven=[divide, very, fast]`. Root cause: dictionary forgiveness could apply to common words loaded from the admin/hot dictionary list, so the verifier adjusted coverage to 100% and did not treat the missing phrase as substantial. Fixed by allowing dictionary forgiveness only for longer rare terms (>=7 chars) and lowering substantial missing / clipped scrutiny from 5 chars to 4 so `very` and `fast` force re-rolls.
- 2026-06-30: Full Inference could still audibly cut/glitch words even when ASR verification accepted complete chunks. Root cause candidate: `concatWavs` post-processed accepted audio by fading chunk edges, trimming edge silence, and trimming to zero crossings before joining; that can shave soft word starts/tails after synthesis. Fixed by preserving generated PCM samples exactly during concat and only inserting the join pause. Regression test added.
- 2026-06-30: Full Inference dropped whole spans of words (e.g. "barrels of nine triplet microtubules" vanished). Root cause in `synthesizeChunkResilient` (`gpu-inference-worker/src/services/longTextInference.js`) pass 4: when no clean read existed, it returned the single highest-scoring candidate from `salvage` — but salvage held PARTIAL-span sub-chunks, so a passing first half ("Each centriole is made up of") could be returned as the WHOLE chunk, dropping the rest. Fixed: pass 4 now best-efforts EVERY span and concatenates, guaranteeing the full chunk text is always spoken (a mispronounced word is acceptable; a dropped one is not). Removed the partial-span `pickBestCandidate`/`salvage` path. Regression test added; 23 worker tests pass. NOTE: this, not chunk size, was the cause of the "skips 10 words at once" reports.
- 2026-06-30: Admin pronunciation dictionary ARPAbet entries had no effect (e.g. `centriole` still synthesized as "central/essential", causing the word to be dropped and reported as a skip). Root cause: GPT-SoVITS `english.py` reads `engdict-hot.rep` only when rebuilding `engdict_cache.pickle`; the cache (dated Jun 8) predated the hot file (Jun 30), so the engine kept loading the stale pickle and never saw the hot entries — even across restarts. On the box, dict path/load were all correct (`/home/ubuntu/gpt-sovits-v2pro`, valid phonemes, engine started after the hot-file write); only the cache shadowed it. Fixed `writeHotDictionaryOverrides` to invalidate `engdict_cache.pickle` on hot-file change and to drop a cache older than the hot file (self-heal); `/inference/start` now also restarts on `cacheInvalidated`. Manual one-time fix on the GPU box: `rm /home/ubuntu/gpt-sovits-v2pro/GPT_SoVITS/text/engdict_cache.pickle` then restart `gpu-inference-worker`. NOTE: the deployment uses the `.env` root (`gpt-sovits-v2pro`), NOT `.env.gpuinferenceworker.deployment` (`/opt/gpt-sovits`, a stale 2025 leftover).

- 2026-06-26: Deployed Live Full chatbot chunk playback still returned `Cannot GET /inference/chunk/...` after the code was pulled because the `gpu-inference-worker` Node process had not reloaded the updated route table. Restarted `gpu-inference-worker`; localhost and public fake chunk checks now reach the route and return `Chunk not ready or session not found` instead of Express HTML.
- 2026-06-26: Live Full chatbot queued replies could drift to the current engine/config between generated phrases because the phrase loop read `engineRef.current` during each phrase. The payload also did not match Text to Speech Full because `voiceProfileId` and `inference_mode: quality` were stripped before per-phrase synthesis. Fixed by snapshotting engine/ref/config once per assistant reply and preserving the full-inference identity/quality fields; targeted client test and Live Fast build passed.
- 2026-06-26: Queued Live Full chatbot phrases could sound inconsistently soft because each phrase usually returned a one-chunk full-inference WAV, and `synthesizeLongText` bypassed `concatWavs` normalization for one-chunk outputs. Fixed by always running full-inference final output through `concatWavs`; targeted worker test passed.
- 2026-06-26: Live Full chatbot still differed from Text to Speech Full because it launched a separate full-inference request per phrase, while TTS Full uses one session for the whole text. Reworked chatbot Live Full to use one `/inference/generate` session and fetch/play completed chunks from that session.
- 2026-06-26: Deployed Live Full chatbot chunk playback returned `No Lambda route for GET /api/inference/chunk/...` because the top-level Lambda router regex did not include the new chunk route. Fixed router pattern and added a router regression test.
- 2026-06-26: Browser chunk playback could request `/inference/chunk/...` without the `/api` prefix and get `Cannot GET /inference/chunk/...`. Fixed `getInferenceChunk` to build an explicit API URL with `resolveApiPath`.
- 2026-06-12: Live Fast `/api/voice-profile/activate` returned CloudFront 403 for full metadata payloads around 8 KB. Fixed by compacting activation reference metadata in `client/src/lib/voiceProfilePayload.js`; rich details remain in saved config records.
- 2026-06-12: `/api/models/select` could auto-select and persist saved-profile references without creating `voice-profile-configs/<voiceProfileId>/default.json`, leaving Live Fast with no default saved config after model selection. Fixed in `lambda/shared/modelSelection.js`; targeted Lambda tests passed.
