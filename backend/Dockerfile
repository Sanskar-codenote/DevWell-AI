FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM node:20-alpine AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init \
 && addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=frontend-build /frontend/dist ./dist
COPY backend/ .

USER appuser
EXPOSE 3001

CMD ["dumb-init", "node", "server.js"]
