# ─── Build Stage: Frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ─── Build Stage: Backend ───────────────────────────────────────────────────
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ .

# ─── Production Stage ───────────────────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache dumb-init \
 && addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

ENV NODE_ENV=production

COPY --from=backend-builder --chown=appuser:appgroup /app ./
COPY --from=frontend-builder --chown=appuser:appgroup /frontend/dist ./dist

USER appuser

# Healthcheck to ensure Railway can monitor the container
# We use 3001 as a fallback for the healthcheck if PORT is not set, 
# but in Railway, the PORT env var will be present.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3001}/api/health || exit 1

CMD ["dumb-init", "node", "server.js"]
