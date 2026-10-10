# syntax=docker/dockerfile:1.7

# Chronolignée — worker.
#
# A separate image from the web app on purpose: the two scale differently, a
# crash in one must not take the other down, and an import that runs for six
# minutes has no business inside a request handler.

FROM node:22.15.1-alpine AS base

# pnpm via npm rather than corepack: corepack resolves its shim against a
# cache directory that does not survive predictably between build stages, and
# a pinned global install is both deterministic and one fewer moving part.
RUN npm install --global pnpm@12.4.2
RUN apk add --no-cache libc6-compat

WORKDIR /app

# The manifests, copied once and reused by both install stages below.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY apps/desktop/package.json ./apps/desktop/
COPY packages/ai/package.json ./packages/ai/
COPY packages/config/package.json ./packages/config/
COPY packages/domain/package.json ./packages/domain/
COPY packages/db/package.json ./packages/db/
COPY packages/engine/package.json ./packages/engine/
COPY packages/gedcom/package.json ./packages/gedcom/
COPY packages/genealogy/package.json ./packages/genealogy/
COPY packages/jobs/package.json ./packages/jobs/
COPY packages/mail/package.json ./packages/mail/
COPY packages/storage/package.json ./packages/storage/
COPY packages/ui/package.json ./packages/ui/

# ---------------------------------------------------------------------------
# Build dependencies — everything, including what only the build needs
# ---------------------------------------------------------------------------
FROM manifests AS deps
# The desktop edition's Electron runtime has no place in a server image.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
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

ENV DATABASE_URL=postgresql://placeholder/placeholder
RUN pnpm --filter @chronolignee/db exec prisma generate

# Typecheck inside the image build as well as in CI. An image that compiles
# nothing can ship code that does not compile, and the first sign of that would
# be a crash loop in production.
RUN pnpm --filter @chronolignee/worker typecheck

# `pnpm deploy` produces a self-contained directory with the workspace
# packages copied in and a flat node_modules.
#
# A plain copy of node_modules does not work here: pnpm isolates dependencies
# per package, so the worker's own deps live in apps/worker/node_modules and
# resolve through symlinks into a store that does not exist in the runtime
# image. The first attempt at this image started and immediately died on
# "Cannot find package 'tsx'".
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store     pnpm deploy --filter @chronolignee/worker --prod --legacy /deploy

# The generated Prisma client is gitignored, so it has to be carried across
# explicitly rather than arriving with the source.
RUN cp -r /app/packages/db/generated /deploy/node_modules/@chronolignee/db/generated

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production

# A dedicated unprivileged user. A container that runs as root turns any
# remote-code bug into root inside the container.
RUN addgroup --system --gid 1001 chronolignee \
 && adduser --system --uid 1001 --ingroup chronolignee chronolignee

COPY --from=build --chown=chronolignee:chronolignee /deploy ./

USER chronolignee

# Liveness over HTTP: 200 while the queue consumer runs, 503 once it stopped.
ENV WORKER_HEALTH_PORT=3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tsx runs the TypeScript directly. The worker starts once and then waits on a
# queue, so a compile step would add build time and a second artefact to keep
# in step for nothing measurable at runtime.
CMD ["node", "--import", "tsx", "src/index.ts"]
