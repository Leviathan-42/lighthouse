# Lighthouse — convenience wrappers. Run on the Ubuntu host.
# On Windows, use the equivalent `pnpm` scripts in the root package.json.

.PHONY: help dev up down restart logs build seed typecheck install clean

help:
	@echo "Lighthouse make targets:"
	@echo "  make install    — pnpm install (run once)"
	@echo "  make dev        — run api (:4000) and web (:5173) with hot reload"
	@echo "  make up         — build and start the full prod compose stack"
	@echo "  make down       — stop the compose stack"
	@echo "  make restart    — down + up"
	@echo "  make logs svc=lighthouse-api  — tail logs for one service"
	@echo "  make typecheck  — tsc --noEmit across the monorepo"
	@echo "  make seed       — seed SQLite with fake deploys (step 7)"

install:
	pnpm install

dev:
	pnpm dev

typecheck:
	pnpm -r typecheck

up:
	docker compose -f infra/compose.yml --env-file .env up -d --build

down:
	docker compose -f infra/compose.yml --env-file .env down

restart: down up

logs:
	docker compose -f infra/compose.yml --env-file .env logs -f $(svc)

seed:
	pnpm --filter @lighthouse/api seed

clean:
	rm -rf node_modules apps/*/node_modules packages/*/node_modules apps/*/dist
