# Vega — Vite-built PWA served by nginx.
# Build context must be the repo root so pnpm workspace resolves.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/vega/package.json apps/vega/
RUN pnpm fetch --filter @lighthouse/vega
COPY apps/vega apps/vega
RUN pnpm install --filter @lighthouse/vega --frozen-lockfile --offline
RUN pnpm --filter @lighthouse/vega build

FROM nginx:1.27-alpine AS runtime
COPY apps/vega/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/vega/dist /usr/share/nginx/html
EXPOSE 80
