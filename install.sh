#!/usr/bin/env bash
# Lighthouse installer — Ubuntu 24.04 LTS, behind Tailscale.
#
# Usage (fresh box):
#   curl -fsSL https://<your-gitea>/ezra/lighthouse/raw/branch/main/install.sh | bash
# Or locally after cloning:
#   sudo ./install.sh
#
# Idempotent. Re-run to pull updates and restart the stack.

set -euo pipefail

REPO_URL="${LIGHTHOUSE_REPO_URL:-https://github.com/your-handle/lighthouse.git}"
INSTALL_DIR="${LIGHTHOUSE_DIR:-/opt/lighthouse}"
BRANCH="${LIGHTHOUSE_BRANCH:-main}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
err()  { printf "\033[31merror:\033[0m %s\n" "$*" >&2; exit 1; }
info() { printf "  %s\n" "$*"; }

bold "Lighthouse installer"

# ── prereqs ───────────────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ] && [ -z "${LIGHTHOUSE_SKIP_SUDO:-}" ]; then
  info "re-executing under sudo"
  exec sudo -E bash "$0" "$@"
fi

. /etc/os-release 2>/dev/null || true
if [ "${ID:-}" != "ubuntu" ] && [ "${ID:-}" != "debian" ]; then
  info "note: tested on Ubuntu 24.04 / Debian; you are on ${PRETTY_NAME:-unknown}"
fi

for cmd in curl git; do
  command -v "$cmd" >/dev/null 2>&1 || apt-get update && apt-get install -y "$cmd"
done

# ── Docker ────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  bold "installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1; then
  err "docker compose plugin missing — install with: apt-get install -y docker-compose-plugin"
fi

# ── Tailscale ────────────────────────────────────────────────────────────
if ! command -v tailscale >/dev/null 2>&1; then
  bold "installing Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi

if ! tailscale status >/dev/null 2>&1; then
  err "tailscaled not authenticated — run: tailscale up (then re-run this script)"
fi

# ── Clone / update ───────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  bold "pulling latest Lighthouse into $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --tags
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only
else
  bold "cloning Lighthouse into $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ── .env ──────────────────────────────────────────────────────────────────
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cp .env.example .env
  chmod 600 .env
  echo
  bold "created $INSTALL_DIR/.env from template"
  info "edit it to fill in Tailscale + Gitea credentials, then re-run this script"
  echo "  \$EDITOR $INSTALL_DIR/.env"
  echo "  sudo bash $INSTALL_DIR/install.sh"
  exit 0
fi

# ── Build + bring up ─────────────────────────────────────────────────────
bold "building and starting the compose stack"
docker compose -f infra/compose.yml --env-file .env pull --ignore-buildable || true
docker compose -f infra/compose.yml --env-file .env up -d --build --remove-orphans

# ── systemd unit ─────────────────────────────────────────────────────────
UNIT=/etc/systemd/system/lighthouse.service
if [ ! -f "$UNIT" ] || ! cmp -s infra/lighthouse.service "$UNIT"; then
  bold "installing systemd unit"
  install -m 0644 infra/lighthouse.service "$UNIT"
  systemctl daemon-reload
fi
systemctl enable lighthouse.service >/dev/null 2>&1 || true

# ── Tailscale serve ──────────────────────────────────────────────────────
bold "publishing on the tailnet"
bash "$INSTALL_DIR/infra/tailscale-serve.sh"

echo
bold "Lighthouse is up"
info "tailnet URL:  $(tailscale status --json 2>/dev/null | grep -oP '"DNSName":\s*"\K[^"]+' | head -1)"
info "local probe:  curl http://127.0.0.1:8080/healthz"
info "logs:         make -C $INSTALL_DIR logs svc=lighthouse-api"
