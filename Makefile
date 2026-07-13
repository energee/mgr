# MGR Harness Makefile
#
# One front door for agents and humans. Wraps `bun` scripts so the layered
# verification gate (static -> unit -> E2E, per Lecture 09) lives in one place.
#
# Quick start:
#   make help          list every target
#   make setup         install deps and run bootstrap script
#   make dev           start Next.js dev server
#   make check         pre-commit gate (lint + typecheck + test + check-db + check-wip + build)
#   make check-all     full gate plus Playwright E2E

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help setup dev build \
        lint typecheck test e2e \
        check-fast check check-all check-db check-wip check-coverage check-agent-config \
        verify-feature feature-mark \
        worktree worktree-list worktree-doctor \
        db-generate db-generate-local db-migrate db-seed db-dry-run \
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

check-fast: lint typecheck check-agent-config ## Layer 1: static checks only (fast feedback)

check-agent-config: ## Validate shared agent skills and worktree tooling
	@bash scripts/check-agent-config.sh
	@bash scripts/__tests__/agent-worktree.test.sh

check-db: ## DB rule checks (security_invoker / RLS / auth.users / search_path / SECURITY DEFINER / schema_registry / data-model docs / permissive RLS)
	@bun run scripts/check-security-invoker.ts
	@bun run scripts/check-rls.ts
	@bun run scripts/check-auth-users-leak.ts
	@bun run scripts/check-search-path.ts
	@bun run scripts/check-security-definer.ts
	@bun run scripts/check-permissive-rls.ts
	@bun run scripts/check-schema-registry.ts
	@bun run scripts/check-data-model-docs.ts

check-wip: ## Verify WIP=1 per branch in feature_list.json
	@bun run scripts/check-wip.ts

check-coverage: ## Vitest with coverage (thresholds enforced via vitest.config.ts)
	@bun run test:coverage

check: lint typecheck test check-db check-wip build ## Layers 1+2: pre-commit gate
	@echo "OK: check passed"

check-all: check e2e ## Layers 1+2+3: full gate including Playwright E2E
	@echo "OK: check-all passed"

verify-feature: ## Run a single feature's verification (usage: make verify-feature ID=F003)
	@if [ -z "$(ID)" ]; then echo "Usage: make verify-feature ID=F003" >&2; exit 1; fi
	@bash scripts/verify-feature.sh $(ID)

feature-mark: ## Mark a feature's state (usage: make feature-mark ID=F003 STATE=passing)
	@if [ -z "$(ID)" ] || [ -z "$(STATE)" ]; then \
		echo "Usage: make feature-mark ID=F003 STATE=in_progress [EVIDENCE=...]" >&2; exit 1; fi
	@bun run scripts/feature-mark.ts $(ID) $(STATE) $(if $(EVIDENCE),--evidence="$(EVIDENCE)")

# Shared agent worktrees

worktree: ## Create/resume a shared worktree (usage: make worktree NAME=my-task [BASE=origin/main] [BRANCH=feat/my-task])
	@if [ -z "$(NAME)" ]; then echo "Usage: make worktree NAME=my-task [BASE=origin/main] [BRANCH=feat/my-task]" >&2; exit 1; fi
	@bash scripts/agent-worktree create "$(NAME)" $(if $(BASE),--base "$(BASE)") $(if $(BRANCH),--branch "$(BRANCH)")

worktree-list: ## List every worktree registered with this repository
	@bash scripts/agent-worktree list

worktree-doctor: ## Report legacy, misplaced, or stale worktrees
	@bash scripts/agent-worktree doctor

# Database

db-generate: ## Regenerate Supabase types from the remote project
	@bun run db:generate

db-generate-local: ## Regenerate Supabase types from local instance
	@bun run db:generate:local

db-migrate: ## Push migrations (supabase db push)
	@bun run db:migrate

db-seed: ## Apply seed data
	@bun run db:seed

db-dry-run: ## Boot fresh local Supabase, replay all migrations from scratch
	@bash scripts/migration-dry-run.sh

# Hygiene

clean: ## Remove build artifacts and caches
	@rm -rf .next tsconfig.tsbuildinfo node_modules/.cache
	@echo "Cleaned: .next/, tsconfig.tsbuildinfo, node_modules/.cache/"
