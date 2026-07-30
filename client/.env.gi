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

# Everything else (PROXY_TARGET, VITE_*_URL) is inherited from .env.
