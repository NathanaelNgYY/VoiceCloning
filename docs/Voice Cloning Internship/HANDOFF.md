# Voice Cloning Project Handoff

Last updated: 2026-08-21

## Current Dev State

- Dev contains staging application behavior plus dev-only learner analytics and voice-quality work.
  Dev remains fixed-instance/on-demand: `GPU_SCHEDULE_ENABLED=false`, no inference ASG, and fixed
  GPU `i-03f258d470a2fa73f` belongs to no ASG.
- Dev GI uses the centered D25 staging login, not the faculty split-panel design. The SPA shell
  now returns `no-store, must-revalidate, no-cache`, preventing a first navigation from reusing
  the deleted split-layout bundle.
- Final deployed Dev client assets are Training `index-DSP9b2By.js`, Live Fast
  `index-DKYckGK7.js`, and GI `index-Bii-ZJZj.js`. Their CloudFront invalidations completed;
  all three public hosts returned HTTP 200 with those assets and the expected cache header.
- The inference-config header now truncates long filenames without moving Save new outside
  its card. Background model discovery/load uses silent optional auth because those endpoints
  are public; protected analytics/synthesis still requires a token. A `pageshow` guard reloads
  browser-history snapshots so an obsolete faculty-style login is not restored.
- Model load waits for the selected model's rank-1 config. Curated/user-reordered rank 1 is
  authoritative. Untouched or legacy cross-model `default` rank 1 runs scored `Use best`
  only on the experiment derived from the selected weights, then stores the same references
  in default config and voice profile. The Load button is inference-session-only.
- `dea-voice-version2-v1` was repaired live: its old `leehseinlongnew` references were
  replaced by one primary and five auxiliary `dea-voice-version2` clips. S3 readback proved
  profile/config equality, six same-experiment paths, rank 1, and mode `auto`.
- Training now filters acoustically bad or implausibly transcribed clips before features.
  Reference selection uses measured metrics and diversity. The shadow phoneme verifier has
  monotonic per-phone CTC evidence and a weakest-phone floor. Real listening comparison and
  held-out phoneme calibration are still required; tests do not prove audible improvement.
- Final automated evidence: client 405/405 and Lambda 197/197. Browser verification with a
  real allowlisted Microsoft account remains pending.

## Current Staging State

- Faculty SSO is deployed at `faculty.lkcmedicine.org`: Microsoft sign-in admits only
  staff/associate domains and writes to `vcs-staging-lecturers`. Lectures remains separate.
  A real staff sign-in and lecturer-table write are still unverified.
- Staging Live Fast uses two normal takes and at most two catastrophic-babble reseeds.
  AMI `ami-0b05ebda8d96a924f` is available and staging launch template v27 is default.
- Staging inference ASG `vcs-staging-gpu-inference` has live min/desired 1/2, max 192.
  The 07:00/19:00 Singapore actions preserve min 1 without forcing desired. The fixed GPU
  schedule is 0-24. Lambda cannot directly manage ASG capacity under its current role.
- Staging learner analytics remains absent. Do not deploy dev analytics to staging.
- Stopped builder `i-0f6c399842bd8cc38` and verifier canary `i-0e4ef8844a120d069`
  require administrator termination.

## Operating Rules

- Code repo/branch: `VoiceCloning` / `separate-containers-new`.
- AWS account/role: `329599637774` / `Liu_Teng_Yu_Intern2026`. Read user-level
  `VCS_AWS_*`, map them to process `AWS_*`, assume the role, and verify identity before writes.
  Never print or persist credentials or private URLs.
- `lambda/.env.deployment` is incomplete. The deploy script merges it into live Lambda
  variables; snapshot/read live configuration before any configuration update.
- Project memory is mirrored between the primary Obsidian folder and
  `docs/Voice Cloning Internship`; keep edited files byte-identical.
- GitHub push is blocked on this workstation by missing GitHub credentials.

## Next Session

1. Open Dev GI in a new tab with an allowlisted account and confirm the first render (without
   refresh) is D25, then verify sign-in, Dean text/audio, `/admin`, and mobile layout.
2. Exercise the new voice config lifecycle: untouched default reselects only same-model clips;
   Update/reorder pins rank 1; Load previews a config without rewriting the profile.
3. Run a representative clean/noisy Dev training job and inspect `clip-scores.json` and
   `training-quality-report.json`; compare old/new reference sets and cloned audio blind.
4. Collect labeled phoneme crops, calibrate on a training split, and validate on held-out audio
   before changing verifier thresholds.
5. For staging event work, follow `docs/staging-architecture.md` and `TODO.md`; prewarm known
   bursts because reactive scaling is too slow for sudden arrivals.
