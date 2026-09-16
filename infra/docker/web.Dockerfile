# syntax=docker/dockerfile:1.7

# Chronolignée — web.
#
# Multi-stage so the shipped image carries the built application and nothing
# that produced it: no pnpm store, no TypeScript, no source. Built from the
# repository root because this is a monorepo and the app imports workspace
# packages that live outside apps/web.

# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------
FROM node:22.15.1-alpine AS base

# Node 22 is what the repository targets (see .nvmrc and ADR 0002). Pinning the
# patch keeps the image reproducible; a floating tag means two builds of the
# same commit can differ.
# pnpm via npm rather than corepack: corepack resolves its shim against a
# cache directory that does not survive predictably between build stages, and
# a pinned global install is both deterministic and one fewer moving part.
RUN npm install --global pnpm@12.4.2

# Prisma's engines and sharp need it on Alpine.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM base AS deps

# Manifests only, so this layer is cached until a dependency actually changes.
# Copying the whole tree first would rebuild node_modules on every source edit.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/config/package.json ./packages/config/
COPY packages/domain/package.json ./packages/domain/
COPY packages/db/package.json ./packages/db/
COPY packages/engine/package.json ./packages/engine/
COPY packages/gedcom/package.json ./packages/gedcom/
COPY packages/genealogy/package.json ./packages/genealogy/
COPY packages/jobs/package.json ./packages/jobs/
COPY packages/storage/package.json ./packages/storage/
COPY packages/ui/package.json ./packages/ui/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY . .

# The Prisma client is generated code and is gitignored, so it has to be
# produced here. The URL is a placeholder: generation reads the schema, never
# the database.
ENV DATABASE_URL=postgresql://placeholder/placeholder
RUN pnpm --filter @chronolignee/db exec prisma generate

# Placeholders, needed only so the build can evaluate server modules.
#
# `next build` constructs the auth instance to learn the shape of its route,
# and the environment schema refuses to boot on a missing value — which is the
# behaviour we want at runtime and an obstacle at build time. These satisfy the
# schema and reach nothing: the running container is given the real values, and
# the modules read process.env when they execute there.
#
# Nothing here is a secret, and nothing real is ever baked into a layer. An
# image is a distributable artefact; a secret inside one is published to
# everyone who can pull it.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV APP_URL=http://localhost:3000
ENV BETTER_AUTH_URL=http://localhost:3000
ENV BETTER_AUTH_SECRET=build-time-placeholder-never-used-at-runtime-000
ENV REDIS_URL=redis://localhost:6379
ENV S3_ENDPOINT=http://localhost:9000
ENV S3_REGION=us-east-1
ENV S3_BUCKET=placeholder
ENV S3_ACCESS_KEY_ID=placeholder
ENV S3_SECRET_ACCESS_KEY=placeholder
RUN pnpm --filter @chronolignee/web exec next build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# A dedicated unprivileged user. A container that runs as root turns any
# remote-code bug into root inside the container, and on a misconfigured host
# into more than that.
RUN addgroup --system --gid 1001 chronolignee \
 && adduser --system --uid 1001 --ingroup chronolignee chronolignee

# The standalone bundle carries its own minimal node_modules.
COPY --from=build --chown=chronolignee:chronolignee /app/apps/web/.next/standalone ./
COPY --from=build --chown=chronolignee:chronolignee /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=chronolignee:chronolignee /app/apps/web/public ./apps/web/public

USER chronolignee
EXPOSE 3000

# An unauthenticated liveness endpoint. The landing page is static and cheap,
# and it answers the only question a health check should ask: is this process
# serving HTTP.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
