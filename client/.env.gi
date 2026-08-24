VITE_APP_MODE=gi

# The cloned voice this build speaks with. The backend's "active voice profile"
# is a single shared setting, so without this pin the gi app would speak in
# whatever voice was activated last by any other build or operator.
#
# This verifies the active profile rather than selecting one: the browser has no
# by-id profile route (the only one needs a server secret). If the active voice
# is not this one, the chat refuses to start and says so instead of speaking in
# the wrong voice. Override per-session with ?voice=<name>.
VITE_GI_VOICE_PROFILE_ID=DeanVoice

# Reports the lesson video's playback position to the live gateway while a
# conversation is open, so the student can ask "what does she mean here?" without
# naming a timestamp. Needs a gateway that understands the video.position message
# (live-gateway/src/routes/liveChat.js); older gateways ignore it harmlessly.
#
# Set to false to fall back to timestamp-only answers ("at 8:30, what does this
# mean?"), which need nothing from the gateway. That fallback is a frontend
# rebuild only — no gateway redeploy.
VITE_GI_VIDEO_POSITION=true

# Origin-agnostic on purpose — do NOT inherit these from .env.
#
# .env pins the worker and gateway to doovx82fh9tfs.cloudfront.net. Inheriting
# that baked the wrong host into every `npm run build:gi` artifact, so a build
# uploaded to any other distribution called back to doovx82fh9tfs instead of the
# origin serving it.
#
# Blank means relative: runtimeConfig.js emits bare paths, so /api/* resolves
# against whatever origin served the page and the /api/live/chat/realtime socket
# falls back to window.location.origin. One artifact works on every
# distribution, which is what makes a hand-upload to S3 safe.
#
# In dev this is strictly better too: the vite proxy forwards /api (ws included)
# and /videos to PROXY_TARGET, keeping /videos same-origin so the video player
# and the thumbnail canvas don't taint.
VITE_API_BASE_URL=
VITE_GI_AUTH_ENABLED=true
VITE_AUTH_MODE=msal
VITE_ENTRA_CLIENT_ID=9b5c52c0-5f02-4dbf-83ac-c68d246abc68
VITE_ENTRA_TENANT_AUTHORITY=https://login.microsoftonline.com/common
VITE_ENTRA_ALLOWED_EMAIL_DOMAINS=staff.main.ntu.edu.sg,student.main.ntu.edu.sg,assoc.main.ntu.edu.sg
VITE_API_AUTH_MODE=entra-id
VITE_GPU_WORKER_URL=
VITE_LIVE_GATEWAY_URL=

# PROXY_TARGET is still inherited from .env — it is vite-level (no VITE_ prefix),
# used only by the dev server proxy and never baked into the bundle.
