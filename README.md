# Lighthouse

A self-hosted homelab dashboard for one person. Monitors Docker containers, streams metrics from Prometheus, tails logs from Loki, maps your Tailscale network, and runs deploy pipelines from Gitea webhooks.

Built for Ubuntu Server 24.04 LTS behind Tailscale. No passwords, no cloud dependencies, no analytics.

---

## What's inside

| App | Tech | What it does |
|---|---|---|
| `apps/web` | Vite + React + TypeScript | Dashboard UI — Overview, Service Detail, Network Map, Deploy Feed, Command Palette |
| `apps/api` | Fastify + TypeScript + SQLite | Backend — Docker, Prometheus, Loki, Tailscale API, deploy engine, webhooks, terminal proxy |
| `apps/vega` | Vite + React + TypeScript | Media PWA — search Torrentio, add to Real-Debrid, browse TMDb |
| `packages/shared` | TypeScript | Shared types between web and api |

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────────────┐
│  tailscale  │────▶│   traefik   │────▶│  lighthouse-web (nginx)    │
│   serve     │     │   (:8080)   │     └─────────────────────────────┘
└─────────────┘     └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
      lighthouse-api    vega      prometheus / loki
      (:4000)          (:80)      cadvisor / node-exporter
```

- **Auth**: Tailscale identity via the `Tailscale-User-Login` header. No session store.
- **Metrics**: Prometheus scrapes cAdvisor + node-exporter. API queries PromQL live.
- **Logs**: Loki ingests via Promtail. API queries `/loki/api/v1/query_range` and `/tail`.
- **DB**: SQLite at `/data/lighthouse.db`. Only stores user prefs, pinned services, and deploy history.
- **Deploys**: Gitea webhook → shallow clone → `docker compose build` → healthcheck → done. Streamed over SSE.

## Quick start

### Requirements

- Ubuntu 24.04 LTS (or Debian)
- Node 22 + pnpm 10
- Docker with compose plugin
- Tailscale authenticated and running

### Fresh server install

```bash
curl -fsSL https://github.com/Leviathan-42/lighthouse/raw/branch/main/install.sh | sudo bash
```

The script installs Docker and Tailscale if missing, clones to `/opt/lighthouse`, creates `.env` from the template, and prompts you to edit it. Re-run after filling in credentials to build and start the stack.

### Local development

```bash
# 1. Install dependencies
pnpm install

# 2. Copy and fill in env
cp .env.example .env
# Edit .env — at minimum set LIGHTHOUSE_AUTH_BYPASS=1 for local dev

# 3. Start the observability stack
docker compose -f infra/compose.dev.yml up -d

# 4. Start api + web + vega
pnpm dev
```

| URL | What |
|---|---|
| http://localhost:5173 | Lighthouse dashboard |
| http://localhost:4000 | API |
| http://localhost:8097 | Vega media PWA |

### Useful commands

```bash
make dev        # api (:4000) + web (:5173) with hot reload
make up         # full prod compose stack
make down       # stop compose stack
make logs svc=lighthouse-api
make seed       # seed SQLite with fake deploys
make typecheck  # tsc --noEmit across monorepo
```

## API routes

All JSON. Prefix `/api/v1` unless noted.

| Route | Description |
|---|---|
| `GET /healthz` | Liveness probe (root level) |
| `GET /readyz` | Checks Prometheus, Loki, Docker socket, Tailscale API |
| `GET /services` | All containers + configured bare-metal hosts |
| `GET /services/:id` | Single service detail |
| `GET /services/:id/metrics?range=5m` | CPU / RAM / net sparkline arrays from Prometheus |
| `GET /services/:id/logs?level=&since=&tail=` | SSE log stream from Loki, falls back to `docker logs --follow` |
| `POST /services/:id/restart` | `docker restart` |
| `POST /services/:id/redeploy` | Trigger deploy pipeline |
| `GET /services/:id/terminal` | WebSocket container exec shell |
| `GET /tailnet/devices` | Tailscale API device list |
| `GET /tailnet/devices/:id` | Single device + ACL snippet |
| `GET /tailnet/traffic` | SSE active link events |
| `GET /deploys` | Last 50 deploys from SQLite cache |
| `GET /deploys/:id` | Single deploy detail + diff |
| `POST /deploys/:id/rollback` | Re-deploy previous SHA |
| `POST /deploys/:id/cancel` | Kill running pipeline |
| `GET /deploys/:id/events` | SSE stage transitions |
| `POST /hooks/gitea` | Signed webhook receiver |
| `GET /media/search?q=` | Search movies / shows via TMDb + Torrentio |
| `GET /media/trending` | Trending movies and shows |
| `POST /media/add` | Add magnet to Real-Debrid library |

## Environment

Copy `.env.example` to `.env` and fill in:

```bash
# Tailscale OAuth client (for tailnet device list)
TAILSCALE_CLIENT_ID=
TAILSCALE_CLIENT_SECRET=
TAILSCALE_TAILNET=

# Self-hosted Gitea / Forgejo (for deploy webhooks + diffs)
GITEA_URL=
GITEA_TOKEN=
GITEA_WEBHOOK_SECRET=

# Dev only — skips Tailscale header check. Leave empty in prod.
LIGHTHOUSE_AUTH_BYPASS=1
```

## Design

The visual design is intentionally fixed. Colors, spacing, type scale, and motion tokens live in `apps/web/src/tokens.css`. Components live in `apps/web/src/primitives.tsx`. If you think something needs to change visually, open an issue before touching it.

Keyboard shortcuts:
- `⌘K` — Command palette
- `g` `o` — Go to Overview
- `g` `n` — Go to Network
- `g` `d` — Go to Deploys
- `Esc` — Back to Overview from detail view

## License

MIT
