# syntax=docker/dockerfile:1

# Build from the repo root so the workspace lockfile is in context. Compose
# does this for you; by hand it is:
#   docker build -f apps/api/Dockerfile -t logverifier-api .
FROM oven/bun:1.3.14-alpine

WORKDIR /app

# Manifests first, so dependencies only re-resolve when they actually change.
# Every workspace manifest has to be present for --frozen-lockfile to verify
# the lockfile, even though --filter installs only this service's tree.
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN bun install --frozen-lockfile --production --filter @logverifier/api

COPY apps/api ./apps/api

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000

WORKDIR /app/apps/api
USER bun
EXPOSE 4000

# Bun runs the TypeScript sources directly, so there is no build artifact to
# keep in sync with what `bun run dev` executes.
CMD ["bun", "src/server.ts"]
