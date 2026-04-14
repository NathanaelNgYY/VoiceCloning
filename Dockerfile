FROM node:22-bookworm-slim AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV SERVER_HOST=0.0.0.0
ENV SERVE_CLIENT_DIST=true
ENV CLIENT_DIST_DIR=/app/client/dist
WORKDIR /app

# This image packages the Node UI/API layer.
# Mount or bake a Linux-ready GPT-SoVITS installation and point GPT_SOVITS_ROOT at it.
COPY server/ ./server/
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=client-builder /app/client/dist ./client/dist

EXPOSE 3000
WORKDIR /app/server
CMD ["npm", "start"]
