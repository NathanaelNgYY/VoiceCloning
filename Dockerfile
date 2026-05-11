FROM alpine:3.20

RUN printf '%s\n' \
  'This repository now uses per-service Dockerfiles:' \
  '  docker build -f gpu-worker/Dockerfile -t voice-gpu-worker .' \
  '  docker build -f lambda/Dockerfile -t voice-lambda-api .' \
  '  docker build -f live-gateway/Dockerfile -t voice-live-gateway .' \
  'See docs/containerization-images.md for the full workflow.' \
  && false
