# Lighthouse — Build Brief for Claude Code

You are being handed a **design prototype** for a self-hosted homelab dashboard called **Lighthouse**. Your job is to turn it into a real, production-grade app that I can run on my Ubuntu Server 24.04 LTS box behind Tailscale.

This document is the source of truth. Read it end-to-end before writing anything. When in doubt, ask me — don't guess at architecture.

---

## 1. What exists in this repo

- `Lighthouse.html` — the prototype shell. Loads React + Babel in-browser and renders the UI.
- `tokens.css` — the full design system (colors, spacing, radii, type scale, motion tokens). **Keep as-is.**
- `primitives.jsx` — `Button`, `Card`, `StatusDot`, `Sparkline`, `Badge`, `Kbd`, `DataTable`, `Icon`. **Keep as-is.**
- `screens.jsx` — `Sidebar`, `TopBar`, `ServiceCard`, `Overview`, `ServiceDetail`.
- `screens2.jsx` — `NetworkMap`, `DeployFeed`, `CommandPalette`.
- `data.jsx` — **this is fake.** Hardcoded mock arrays. Your job is to delete this and replace it with real API calls.

The visual design is final. Do not re-theme, re-type, re-space, or "improve" the UI. Every pixel is on purpose. If you think something needs to change visually, ask first.

---

## 2. Target architecture

Monorepo, two apps, one compose stack.

```
lighthouse/
├── apps/
│   ├── web/          # Vite + React, ports the existing JSX
│   └── api/          # Fastify + TypeScript, the backend
├── infra/
│   ├── compose.yml   # prod stack
│   ├── compose.dev.yml
│   ├── traefik/
│   ├── prometheus/
│   ├── loki/
│   └── promtail/
├── packages/
│   └── shared/       # TS types shared between web and api
├── .env.example
├── Makefile          # `make up`, `make down`, `make logs`, `make seed`
└── README.md
```

### Stack choices (non-negotiable unless I say otherwise)
- **Backend:** Node 22 + TypeScript + **Fastify** (not Express). Pino for logs. Zod for validation.
- **Frontend:** **Vite** + React 18 + TypeScript. Port the existing `.jsx` files to `.tsx`. Keep inline styles — don't rip them out for Tailwind or CSS modules.
- **Auth:** Tailscale identity via the `Tailscale-User-Login` header that `tailscale serve` injects. No password, no OIDC, no session store. If the request doesn't come through the tailnet, 403.
- **DB:** SQLite + Drizzle ORM, single file at `/data/lighthouse.db`. Only used for user prefs, pinned services, deploy history cache. Metrics and logs are **never** stored by us — we query Prometheus and Loki live.
- **No Redis, no Postgres, no Kafka.** This is a homelab tool for one person.

---

## 3. What the backend needs to do

Implement these endpoints. All under `/api/v1`. All return JSON. All should stream (SSE) where the UI expects live data.

### Services
- `GET /services` — list every container Docker knows about + every bare-metal host in `config/hosts.yml`
- `GET /services/:id` — single service detail (uptime, cpu, ram, net, image, tags)
- `GET /services/:id/logs?level=&since=&tail=` — SSE stream from Loki. Fall back to `docker logs --follow` if Loki is down.
- `GET /services/:id/metrics?range=5m` — cpu + ram + net sparkline arrays, from Prometheus PromQL
- `POST /services/:id/restart` — `docker restart <id>`
- `POST /services/:id/redeploy` — triggers the deploy pipeline (see §5)

### Network
- `GET /tailnet/devices` — calls Tailscale API `/api/v2/tailnet/-/devices` with OAuth client creds from env
- `GET /tailnet/devices/:id` — single device detail + ACL policy snippet
- `GET /tailnet/traffic` — SSE of active-link events, polled from `tailscale status --json` every 2s

### Deploys
- `GET /deploys` — list of last 50, oldest-to-newest, from our SQLite cache
- `GET /deploys/:id` — single deploy detail + diff (query Gitea/Forgejo for the diff on demand)
- `POST /deploys/:id/rollback` — re-deploys the previous `sha` for that service
- `POST /deploys/:id/cancel` — kills a running pipeline

### Webhooks
- `POST /hooks/gitea` — signed webhook receiver. On push: clone, build, deploy, healthcheck. Record each step in SQLite.

### Health
- `GET /healthz` — our own liveness
- `GET /readyz` — verifies Prometheus, Loki, Docker socket, Tailscale API all reachable

---

## 4. Data sources

| What you need | Where it comes from |
|---|---|
| Container list, state, stats | `docker.sock` via `dockerode` (mount read-only into api container) |
| CPU/RAM/net metrics | Prometheus HTTP API (`/api/v1/query_range`), scraping `cadvisor` + `node_exporter` |
| Logs | Loki HTTP API (`/loki/api/v1/query_range` + `/loki/api/v1/tail`) |
| Tailscale peers, latency, subnets | Tailscale API v2 (OAuth client) + local `tailscale status --json` |
| Git state, diffs | Self-hosted Gitea/Forgejo API (token in env) |
| Exit-node flag | `tailscale status --json` → `Self.ExitNode` |

PromQL I need you to write:
- CPU per container: `rate(container_cpu_usage_seconds_total{name=~"$svc"}[1m]) * 100`
- RAM: `container_memory_working_set_bytes{name=~"$svc"} / 1024 / 1024`
- Net in/out: `rate(container_network_receive_bytes_total{name=~"$svc"}[1m])`

---

## 5. Deploy pipeline

Simple is fine. One concurrent deploy per service. Queue the rest.

```
checkout → build → test → deploy → healthcheck → done
```

- **checkout:** shallow clone of the pushed SHA into `/tmp/deploys/<id>`
- **build:** `docker compose build` in the service's dir, tag with the short SHA
- **test:** optional `make test` if the Makefile has the target, skip otherwise
- **deploy:** `docker compose up -d` to swap in the new image
- **healthcheck:** hit the service's `/healthz` for up to 30s, three consecutive 200s = pass
- **rollback:** `docker compose up -d` with the previous tag

Record every stage transition with timestamp + duration to SQLite. Stream them over SSE to `/api/v1/deploys/:id/events` so the UI pipeline stepper animates live.

---

## 6. Frontend port

1. Rename `.jsx` → `.tsx`, add types from `packages/shared`.
2. Delete `data.jsx`. Create `apps/web/src/lib/api.ts` with a typed fetch client + React Query hooks.
3. Replace every reference to `SERVICES`, `NODES`, `EDGES`, `LOGS`, `DEPLOYS`, `DIFF_PREVIEW` with the matching hook:
   - `useServices()`, `useService(id)`, `useServiceLogs(id)`, `useServiceMetrics(id)`
   - `useTailnetDevices()`, `useTailnetTraffic()`
   - `useDeploys()`, `useDeploy(id)`, `useDeployEvents(id)`
4. The command palette (`screens2.jsx`) needs real actions — wire the "Restart all", "Edit ACL", "Trigger NAS snapshot" items to real API calls or remove them.
5. Loading states: use the existing `grid-texture` class on skeleton cards. Error states: red `StatusDot` + a monospace error line. Don't invent new treatments.
6. Keep keyboard nav (⌘K, g-o/g-n/g-d, Esc). Add `/` to focus search wherever there's a filter input.

---

## 7. Infra / compose

`infra/compose.yml` should spin up:

```yaml
services:
  traefik:       # reverse proxy, ACME via Tailscale serve
  lighthouse-api:
  lighthouse-web: # nginx serving the vite build
  prometheus:
  cadvisor:
  node-exporter:
  loki:
  promtail:
```

- Everything binds to the **tailnet0 interface only** via `--network host` on Linux + published on `100.x.x.x`. Never on `0.0.0.0`.
- The api container mounts `/var/run/docker.sock:/var/run/docker.sock:ro`.
- Prometheus scrape config must auto-discover containers via the Docker SD.
- Promtail tails `/var/lib/docker/containers/*/*.log` with the Docker pipeline stage.
- Data volumes: `prometheus-data`, `loki-data`, `lighthouse-data` (the SQLite file).
- Single `.env` at repo root. Never commit it. `.env.example` is committed with every key empty.

---

## 8. Environment variables

```
# Tailscale (OAuth client — make one at https://login.tailscale.com/admin/settings/oauth)
TAILSCALE_CLIENT_ID=
TAILSCALE_CLIENT_SECRET=
TAILSCALE_TAILNET=            # e.g. your-name@github

# Gitea / Forgejo
GITEA_URL=
GITEA_TOKEN=
GITEA_WEBHOOK_SECRET=

# App
LIGHTHOUSE_DATA_DIR=/data
LIGHTHOUSE_LOG_LEVEL=info
LIGHTHOUSE_PORT=4000

# Internal service URLs (inside the compose network)
PROMETHEUS_URL=http://prometheus:9090
LOKI_URL=http://loki:3100
```

No Anthropic key, no OpenAI key, no cloud keys. Lighthouse does not call any external AI service. The mockup's "Ask Claude" panel has been removed — do not re-add it, do not suggest adding it, do not leave a "TODO: add AI" comment anywhere.

---

## 9. Dev experience

- `make dev` → runs api on `:4000` with tsx watch, web on `:5173` with vite, against a local dockerd
- `make seed` → seeds SQLite with a few fake deploys so the feed isn't empty on first load
- `make up` → builds and starts the full prod compose stack
- `make logs svc=lighthouse-api` → `docker compose logs -f` helper
- `pnpm` for package management. Not npm, not yarn.

Tests: Vitest for unit tests on the api's PromQL builders, log parsers, and deploy state machine. No frontend tests — the UI is the visual spec. Playwright is overkill for a one-user app.

---

## 10. Order of operations

Do it in this order. Show me each step before moving on.

1. **Scaffold the monorepo** — pnpm workspaces, tsconfig, eslint, prettier. Move existing files into `apps/web/src/` and get Vite building them.
2. **Port to TS** — rename, add types, fix the inevitable `any`s properly.
3. **Stand up the api** — Fastify skeleton, `/healthz`, `/readyz`, Zod schemas, one endpoint that lists containers via dockerode. Prove the docker socket wiring works.
4. **Compose stack** — get Prometheus, cadvisor, Loki, Promtail running. Show me one real metric flowing end-to-end before building more endpoints.
5. **Fill in endpoints** — services, metrics, logs, tailnet, deploys, in that order.
6. **Wire the UI** — replace mock data with hooks, one screen at a time. Overview first.
7. **Deploy pipeline** — webhook receiver, state machine, SSE events.
8. **Traefik + Tailscale serve** — publish on the tailnet with a real TLS cert.
9. **Systemd unit + install script** — `curl -fsSL … | bash` on a fresh 24.04 box and it should come up.

---

## 11. Rules

- **Don't silently change the design.** If a component needs a new variant, ask.
- **Don't add features I didn't ask for.** No analytics, no telemetry, no update checker, no "getting started" tour.
- **Don't add dependencies casually.** Every new package needs a one-sentence justification in the PR body.
- **Every commit builds.** No WIP commits on main.
- **When you hit a real decision** — e.g. "should restart be soft or hard?", "should we cache the device list?", "what's the refresh interval for metrics?" — stop and ask me. I'd rather answer five questions than untangle five assumptions.

---

## 12. First message I want from you

When you start, reply with:
1. The exact pnpm/node versions you'll target
2. Any clarifying questions about §2, §4, or §5 before you write code
3. The first file you'd like to create

Then wait for my go-ahead. Don't scaffold 40 files in one shot.
