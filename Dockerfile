# ---- Build stage ----
FROM node:24-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# server.js (Next standalone) binds to localhost by default; 0.0.0.0 so the
# Coolify proxy can reach it.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Next standalone output: minimal server + traced node_modules, then the
# static/public assets it doesn't copy itself.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Migration files — applied once per process at first DB touch (db/index.ts#dbReady).
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 3000
CMD ["node", "server.js"]
