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

# Everything else (PROXY_TARGET, VITE_*_URL) is inherited from .env.
