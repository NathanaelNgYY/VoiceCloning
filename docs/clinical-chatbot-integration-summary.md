# ClinicalChatbot Integration Summary

Last updated: 2026-05-22

## Scope

This document summarizes the current integration between the ClinicalChatbot system and this VoiceCloning system under the `separate-containers` branch structure.

The main goal is:

1. keep the VoiceCloning website and backend in this repo
2. let the ClinicalChatbot keep its own frontend and backend flow
3. make the ClinicalChatbot call this system only when it needs cloned voice output

This repo is being used as a voice-cloning service, not as something that should be merged into the ClinicalChatbot application.

## Current Architecture

The integration is split into two domains:

1. ClinicalChatbot domain
   - owns the chatbot, assignment, scenario, and session logic
   - decides which `voiceProfileId` should be used for a given assignment or chatbot persona
   - calls this VoiceCloning deployment through backend-to-backend requests

2. VoiceCloning domain
   - owns the full cloned-voice profile data
   - stores the selected GPT and SoVITS model references, reference audio, prompt text, prompt language, auxiliary references, and tuning defaults
   - performs the actual GPT-SoVITS synthesis and returns WAV audio

## Integration Flow

The intended flow is:

1. A voice is selected and saved on this VoiceCloning website.
2. This system stores the full voice profile in S3.
3. The ClinicalChatbot backend resolves its local assignment or scenario binding to a stable `voiceProfileId`.
4. The ClinicalChatbot backend can either:
   - call this system to fetch the full saved profile by `voiceProfileId` and then pass all voice fields through explicitly, or
   - call this system with `voiceProfileId + text` only and let this system resolve the full saved profile internally.
5. If this system resolves the saved profile internally, it will load the correct GPT and SoVITS pair before synthesis.
6. The ClinicalChatbot backend calls either `POST /api/live/tts-sentence` or `POST /api/inference`.
7. This system returns `audio/wav` back to the ClinicalChatbot backend.

## What This Repo Implements Now

### 1. Server-side saved voice profiles

This repo now stores full voice profiles in S3 under:

- `voice-profiles/<voiceProfileId>.json`
- `voice-profiles/active.json`

The saved profile includes:

- `voiceProfileId`
- `displayName`
- `gptKey` or `gptPath`
- `sovitsKey` or `sovitsPath`
- `ref_audio_path`
- `prompt_text`
- `prompt_lang`
- `text_lang`
- `preferredRoute`
- `aux_ref_audio_paths`
- inference tuning defaults

### 2. Voice profile endpoints

This repo exposes:

- `POST /api/voice-profile/activate`
- `GET /api/voice-profile/active`
- `GET /api/voice-profile/internal/:voiceProfileId`

The internal route returns the full saved profile and is meant for backend-to-backend use only.

### 2b. Synthesis routes can now resolve `voiceProfileId` internally

This repo now supports a simpler ClinicalChatbot contract:

```json
{
  "voiceProfileId": "obama-v1",
  "text": "Hello from the clinical chatbot."
}
```

When `voiceProfileId` is present on:

- `POST /api/live/tts-sentence`
- `POST /api/inference`
- `POST /api/inference/generate`

this system:

1. loads the full saved profile from server-side storage
2. loads the correct GPT + SoVITS pair if needed
3. applies `ref_audio_path`, `prompt_text`, `prompt_lang`, `aux_ref_audio_paths`, and saved tuning defaults
4. synthesizes the reply

### 3. Internal profile lookup protection

The internal full-profile route is protected by a shared header:

- `VOICE_PROFILE_INTERNAL_AUTH_HEADER_NAME`
- `VOICE_PROFILE_INTERNAL_AUTH_HEADER_VALUE`

The ClinicalChatbot backend must send the matching header and value when calling:

```text
/api/voice-profile/internal/{voiceProfileId}
```

### 4. Persistent UI visibility for saved profiles

The VoiceCloning frontend now shows the active saved profile directly in the UI instead of only returning it in a save response.

This is backed by:

- `GET /api/voice-profile/active`
- a persistent `Active voice profile` label on the Live Fast and TTS Test pages

### 5. Website-selected voice can now sync the saved profile automatically

The website no longer relies only on a manual save after switching voices. When the user changes the selected voice and that voice's own training clips finish loading, the frontend can now auto-pick the best primary reference and up to five auxiliary clips for that selected voice, then sync the active saved profile back to the backend using those references and the current tuning defaults.

This matters for the ClinicalChatbot integration because the external system depends on the server-side saved profile, not only the temporary browser state shown in the settings panel.

## Browser Debug Visibility

The frontend now writes structured browser-console logs to make the saved-profile flow easier to verify during deployment and debugging.

Current console labels include:

- `live voice switched`
- `live auto-selected references`
- `activate request`
- `activate response`
- `activate error`

These logs show whether the current profile save really includes the selected primary reference, the auxiliary reference paths, the prompt fields, and the tuning defaults.

## Route Choice For Synthesis

This system supports two synthesis routes:

### Short reply path

```text
POST /api/live/tts-sentence
```

This is the Live Fast-style path. It is lower-latency and is better for short chatbot replies or sentence-by-sentence playback.

It is implemented in:

- `lambda/live/index.js`

and proxies to:

- `/inference/tts` on the GPU inference worker

Important clarification:

- `POST /api/live/tts-sentence` is still a one-shot route.
- It does not split a long reply into multiple sentence requests by itself.
- If the caller wants Live Fast-style progressive playback, the caller must split the text and queue repeated `POST /api/live/tts-sentence` requests on its own.

### Long reply path

```text
POST /api/inference
```

This is the longer-form inference path. It is better for larger responses where chunking and retry logic should be handled on the server side.

It is implemented in:

- `lambda/inference/index.js`

## Current `preferredRoute` Behavior

Saved voice profiles include a `preferredRoute` field.

Current behavior in this repo:

- profiles saved from Live Fast are stored with `preferredRoute: "sentence"`
- profiles saved from the current TTS Test page are also stored with `preferredRoute: "sentence"` because that page is mounted in `directMode`

That means the current website save flow is effectively aligned to the short synthesis route:

```text
POST /api/live/tts-sentence
```

The long `POST /api/inference` route should be used only when the ClinicalChatbot backend explicitly decides the reply is long enough to require the long-form path, or if a future saved profile is intentionally marked with `preferredRoute: "full"`.

## Important Clarification About `active.json`

`voice-profiles/active.json` is a global active voice pointer.

It is useful for website UI and testing, but it is not the correct long-term runtime source of truth for a system where:

- chatbot A may need one cloned voice
- chatbot B may need another cloned voice

The long-term stable design is:

1. ClinicalChatbot owns the local binding:
   - `assignmentId + scenarioId -> voiceProfileId`
2. VoiceCloning owns the full profile lookup:
   - `voiceProfileId -> full saved profile`

## Current Request-Signing Requirement

This deployment is behind CloudFront to a Lambda Function URL protected with OAC and `AWS_IAM`.

Because of that, JSON mutating requests must include:

```text
x-amz-content-sha256
```

This repo already handles that automatically in the existing frontend client.

The ClinicalChatbot backend must reproduce the same hashing behavior for JSON requests that call:

- `POST /api/models/select`
- `POST /api/live/tts-sentence`
- `POST /api/inference`

## Deployment and Debugging Notes From This Session

### 1. Backend route availability

The new voice-profile routes were added to the Lambda router and handler logic, but deployment debugging showed that updating Lambda code alone was not enough if the packaged zip did not include the new `voice-profile` folder.

This caused `502 Bad Gateway` behavior until the packaging script was corrected.

The packaging script now explicitly includes:

- `voice-profile`

inside:

- `lambda/scripts/package-function-url.ps1`

### 2. Frontend build verification

The frontend changes were verified against both split frontend builds:

- `build:live-fast`
- `build:training`

This mattered because the TTS Test page lives on the training-side frontend build and the saved-profile UI had to be visible there as well.

### 3. Save flow verification

The saved `voiceProfileId` is created when the user presses:

- `Save voice`
- `Save Voice Profile`

It is not created just by selecting a model in the dropdown.

The current frontend auto-generates the ID from the display name if none is supplied explicitly. For example:

- `Obama` -> `obama-v1`
- `Michael Tan` -> `michael-tan-v1`

### 4. Frontend reference-sync reliability fixes

The Live Fast and TTS Test pages were also debugged so they no longer auto-pick reference clips from a stale previous voice while the newly selected voice's clip list is still loading.

The frontend now waits for the selected voice's own clip list before auto-selecting the primary and auxiliary references. This avoids mismatched states where the newly selected voice name is shown while older reference paths are still present in memory.

### 5. Frontend deployment note

Recent integration fixes touched both frontend builds:

- `build:live-fast`
- `build:training`

So a frontend redeploy must update both sites together when testing the latest voice-profile sync behavior.

## Known Constraints

### 1. Global loaded model state

The inference worker still holds only one active GPT and SoVITS pair at a time.

So:

- one main shared voice is easy to support
- multiple personas are still possible
- but switching across many different voices will increase latency and can affect concurrent usage

### 2. Not fully multi-tenant

This architecture is workable for controlled usage and demos, but it is not yet a fully isolated multi-user voice-cloning platform.

## Current Practical Recommendation

For the ClinicalChatbot backend:

1. resolve `assignmentId + scenarioId` to `voiceProfileId`
2. preferred simple path:
   call `POST /api/live/tts-sentence` or `POST /api/inference` with `voiceProfileId + text`
3. optional explicit path:
   call `GET /api/voice-profile/internal/:voiceProfileId`, then `POST /api/models/select`, then synthesize with the full voice fields
4. return `audio/wav` to the chatbot frontend

For this VoiceCloning website:

1. select the intended voice
2. wait for the correct reference clips for that voice to auto-load
3. save the profile if needed, or confirm that the auto-sync has completed
4. confirm the active saved profile shown in the UI or in the browser debug logs

## Summary

The integration is now in a usable state where:

- this repo stores full cloned-voice profiles server-side
- the ClinicalChatbot can look up the correct full profile by `voiceProfileId`
- synthesis can be routed through either the short Live Fast-style endpoint or the longer inference endpoint
- the saved active profile is now visible directly in the VoiceCloning UI

The main remaining architectural discipline is to treat `voiceProfileId` as the stable contract and avoid depending on the global `active.json` pointer as the long-term runtime source of truth for multiple chatbot personas.
