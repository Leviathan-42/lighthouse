# Lighthouse infrastructure

Everything that runs on the Ubuntu host lives here.

## Network layout

```
tailnet (https://<host>.<tailnet>.ts.net)
       │
       ▼
  tailscale serve  ── injects Tailscale-User-Login header
       │
       ▼
  127.0.0.1:8080 (Traefik)  ── label-based routing
       │         │
       ▼         ▼
  lighthouse-web   lighthouse-api        (both on the `lighthouse` bridge network)
                           │
                           ├── prometheus:9090
                           ├── loki:3100
                           ├── cadvisor:8080
                           ├── node-exporter:9100
                           └── /var/run/docker.sock (ro)
```

Nothing listens on `0.0.0.0` — Traefik is bound to loopback, and everything else
is container-internal. `tailscale serve` handles TLS termination and enforces
tailnet-only reach.

## First-time setup on the Ubuntu host

```bash
# 1. Install Docker Engine + compose plugin (once)
curl -fsSL https://get.docker.com | sh

# 2. Install Tailscale (once) and authenticate
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 3. Enable HTTPS + MagicDNS in the admin console
#    https://login.tailscale.com/admin/dns → "Enable HTTPS"

# 4. Clone this repo to /opt/lighthouse (or wherever)
git clone <repo> /opt/lighthouse && cd /opt/lighthouse
cp .env.example .env && $EDITOR .env

# 5. Bring up the compose stack
docker compose -f infra/compose.yml --env-file .env up -d --build

# 6. Publish on the tailnet
sudo ./infra/tailscale-serve.sh
```

After step 6, Lighthouse is reachable at `https://<host>.<tailnet>.ts.net`.

## Adding a service to Lighthouse

Attach these labels to any container you want Lighthouse to track:

| Label                        | Purpose                                                  |
|------------------------------|----------------------------------------------------------|
| `lighthouse.category`        | overview filter bucket (`app`, `auth`, `game`, `db`, …)  |
| `lighthouse.host`            | public hostname shown in the card (e.g. `sso.ts.horizon.rig`) |
| `lighthouse.git_repo`        | Gitea repo full name, used for webhook-triggered deploys |
| `lighthouse.healthcheck`     | URL hit after deploy (default: `http://<host>/healthz`)  |
| `lighthouse.tags`            | comma-separated tags for the detail view                 |
| `prometheus_scrape=true`     | opt the container into Prometheus scraping              |
| `prometheus_port=9090`       | metrics port                                             |
