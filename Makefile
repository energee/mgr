# MGR Harness Makefile
#
# One front door for agents and humans. Wraps `bun` scripts so the layered
# verification gate (static -> unit -> E2E, per Lecture 09) lives in one place.
#
# Quick start:
#   make help          list every target
#   make setup         install deps and run bootstrap script
#   make dev           start Next.js dev server
#   make check         pre-commit gate (lint + typecheck + test + build)
#   make check-all     full gate plus Playwright E2E

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help setup dev build \
        lint typecheck test e2e \
        check-fast check check-all check-db verify-feature \
        db-generate db-generate-local db-migrate db-seed \
        clean

help: ## List available targets
	@awk 'BEGIN {FS = ":.*##"; print "MGR harness targets:"; print ""} \
	      /^[a-zA-Z0-9_-]+:.*##/ {printf "  %-22s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Bootstrap

setup: ## Install dependencies and run the bootstrap script
	@bash scripts/init.sh

# Dev / build

dev: ## Start Next.js dev server (turbopack)
	@bun run dev

build: ## Production build
	@bun run build

# Verification gate

lint: ## ESLint
	@bun run lint

typecheck: ## tsc --noEmit
	@bun run typecheck

test: ## Vitest run (unit + integration)
	@bun run test

e2e: ## Playwright E2E
	@bun run e2e

check-fast: lint typecheck ## Layer 1: static checks only (fast feedback)

check-db: ## DB rule checks (security_invoker / RLS / auth.users leaks)
	@bun run scripts/check-security-invoker.ts
	@bun run scripts/check-rls.ts
	@bun run scripts/check-auth-users-leak.ts

check: lint typecheck test check-db build ## Layers 1+2: pre-commit gate (lint + typecheck + test + check-db + build)
	@echo "OK: check passed"

check-all: check e2e ## Layers 1+2+3: full gate including Playwright E2E
	@echo "OK: check-all passed"

verify-feature: ## Run a single feature's verification (usage: make verify-feature ID=F03)
	@if [ -z "$(ID)" ]; then echo "Usage: make verify-feature ID=F03" >&2; exit 1; fi
	@if [ ! -f docs/feature_list.json ]; then \
		echo "docs/feature_list.json not yet created (Step 2 of harness rollout)." >&2; \
		exit 1; \
	fi
	@bash scripts/verify-feature.sh $(ID)

# Database

db-generate: ## Regenerate Supabase types from the remote project
	@bun run db:generate

db-generate-local: ## Regenerate Supabase types from local instance
	@bun run db:generate:local

db-migrate: ## Push migrations (supabase db push)
	@bun run db:migrate

db-seed: ## Apply seed data
	@bun run db:seed

# Hygiene

clean: ## Remove build artifacts and caches
	@rm -rf .next tsconfig.tsbuildinfo node_modules/.cache
	@echo "Cleaned: .next/, tsconfig.tsbuildinfo, node_modules/.cache/"
