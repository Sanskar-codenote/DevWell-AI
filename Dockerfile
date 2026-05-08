FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM node:20-alpine AS backend-deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS backend-runtime
RUN apk add --no-cache dumb-init \
 && addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend-deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=frontend-builder --chown=appuser:appgroup /frontend/dist ./dist
COPY --chown=appuser:appgroup backend/ .
USER appuser
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3001}/api/health || exit 1
CMD ["dumb-init", "node", "server.js"]

FROM nginx:1.27-alpine AS frontend-runtime
COPY frontend/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=frontend-builder /frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
