# syntax=docker/dockerfile:1

# --- dependencies -----------------------------------------------------------
# Installed in their own stage so application edits do not invalidate the
# npm cache layer.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` is reproducible but needs a lockfile; a fresh clone may not have one
# committed yet, so fall back rather than failing the build.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# --- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# node:alpine ships an unprivileged `node` user; there is no reason to run as root.
USER node

EXPOSE 4000

# Exec form, so SIGTERM reaches node directly and the graceful shutdown in
# src/index.js actually runs.
CMD ["node", "src/index.js"]
