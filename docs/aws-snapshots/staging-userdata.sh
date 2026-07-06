#!/bin/bash
# Staging instance first-boot config (runs as root). Logs to /var/log/staging-bootstrap.log
exec > /var/log/staging-bootstrap.log 2>&1
set -x

STAGCORS="https://d1qh0ebsvevhy3.cloudfront.net,https://dfzrfr93t2ruf.cloudfront.net,https://d25sg72wp8oj5g.cloudfront.net"

# 1) point workers at the staging S3 prefix + staging CORS
for f in /home/ubuntu/VoiceCloning/gpu-worker/.env /home/ubuntu/VoiceCloning/gpu-inference-worker/.env; do
  sed -i 's|^S3_PREFIX=echolect/|S3_PREFIX=echolect-staging/|' "$f"
  sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=$STAGCORS|" "$f"
done

# 2) live gateway: move env out of the unit file into live-gateway/.env
GW_ENV=/home/ubuntu/VoiceCloning/live-gateway/.env
UNIT=/etc/systemd/system/voice-live-gateway.service
grep -q '^PORT=' "$GW_ENV" || echo 'PORT=3002' >> "$GW_ENV"
grep -q '^NODE_ENV=' "$GW_ENV" || echo 'NODE_ENV=production' >> "$GW_ENV"
grep -q '^OPENAI_REALTIME_MODEL=' "$GW_ENV" || echo 'OPENAI_REALTIME_MODEL=gpt-realtime' >> "$GW_ENV"
grep -q '^OPENAI_REALTIME_VAD=' "$GW_ENV" || echo 'OPENAI_REALTIME_VAD=semantic_vad' >> "$GW_ENV"
if grep -q '^CORS_ORIGIN=' "$GW_ENV"; then sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=$STAGCORS|" "$GW_ENV"; else echo "CORS_ORIGIN=$STAGCORS" >> "$GW_ENV"; fi
sed -i '/^Environment=/d' "$UNIT"
grep -q '^EnvironmentFile=' "$UNIT" || sed -i "s|^\[Service\]|[Service]\nEnvironmentFile=$GW_ENV|" "$UNIT"

# 3) legacy cleanup
systemctl disable --now api-v2 2>/dev/null || true
sudo -u ubuntu pm2 delete live-gateway 2>/dev/null || true
sudo -u ubuntu pm2 save 2>/dev/null || true

# 4) restart services with new env
systemctl daemon-reload
systemctl restart gpu-worker gpu-inference-worker voice-live-gateway

# 5) marker
touch /home/ubuntu/STAGING_BOOTSTRAP_DONE
