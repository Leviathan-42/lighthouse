# Lighthouse API — Fastify + TypeScript, run with tsx in-place (no compile step).
# Build context must be the repo root so the pnpm workspace resolves.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Install deps using the workspace manifest. --filter prunes everything but api + shared.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm fetch --filter @lighthouse/api
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN pnpm install --filter @lighthouse/api --frozen-lockfile --offline

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared ./packages/shared
COPY apps/api apps/api
COPY pnpm-workspace.yaml package.json ./

# Use `tini` to reap zombies so SIGTERM shutdowns are clean.
RUN apk add --no-cache tini

EXPOSE 4000
WORKDIR /app/apps/api
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "tsx/esm", "src/index.ts"]
