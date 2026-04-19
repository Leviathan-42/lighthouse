#!/usr/bin/env bash
# Publish Lighthouse on the tailnet with automatic TLS.
#
#   tailscale serve → https://<node>.<tailnet>.ts.net/  →  127.0.0.1:8080 (Traefik)
#
# Requires:
#   - tailscaled running and node authenticated
#   - MagicDNS + HTTPS enabled in the admin console
#     (https://login.tailscale.com/admin/dns → "Enable HTTPS")
#   - Traefik already listening on 127.0.0.1:8080 (see infra/compose.yml)
#
# Run from the repo root: sudo ./infra/tailscale-serve.sh
# Idempotent — safe to re-run. Config persists across reboots.

set -euo pipefail

if ! command -v tailscale >/dev/null 2>&1; then
  echo "error: tailscale CLI not found — install https://tailscale.com/download" >&2
  exit 1
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "error: tailscaled not running or node not authenticated" >&2
  echo "  run: sudo tailscale up" >&2
  exit 1
fi

# Reset any previous serve config for this host (keeps funnel configs untouched)
tailscale serve reset 2>/dev/null || true

# Publish HTTPS (port 443) on the tailnet → local Traefik on 8080
tailscale serve --bg --https=443 http://127.0.0.1:8080

echo
echo "Lighthouse is now reachable on the tailnet:"
tailscale serve status || true
echo
echo "Forwarded request headers include Tailscale-User-Login — the api uses this"
echo "for auth (see apps/api/src/plugins/auth.ts)."
