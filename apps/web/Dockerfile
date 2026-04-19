# Lighthouse Web — Vite-built static bundle served by nginx.
# Build context must be the repo root so the pnpm workspace resolves.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm fetch --filter @lighthouse/web
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm install --filter @lighthouse/web --frozen-lockfile --offline
RUN pnpm --filter @lighthouse/web build

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
