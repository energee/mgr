#!/usr/bin/env bash
# verify.sh — boot the app + log in (up), or tear it down (down).
#
# Collapses the preflight/auth dance into one idempotent call so a verify run
# costs two Bash round-trips instead of six. Prints the base URL on stdout;
# everything else goes to stderr so callers can do BASE=$(verify.sh up).
#
# REQUIRES the sandbox disabled: Next needs listen(2) on a port, agent-browser
# needs to create ~/.agent-browser. Both fail with EPERM otherwise.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# State keyed by worktree so parallel worktrees don't fight over one pidfile.
KEY="$(printf '%s' "$ROOT" | shasum | cut -c1-8)"
STATE="${TMPDIR:-/tmp}/mgr-verify-$KEY"
PIDF="$STATE/server.pid"; LOGF="$STATE/server.log"; URLF="$STATE/base_url"
mkdir -p "$STATE"

DEV_LOGIN='Dev Login (dev@brewery.test)'

die() { echo "verify: $*" >&2; exit 1; }

server_alive() {
  [ -s "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null && [ -s "$URLF" ] \
    && curl -sf -o /dev/null --max-time 3 "$(cat "$URLF")/login"
}

start_server() {
  # Worktrees carry only .env.example; the real .env lives in the main checkout,
  # which is always the first entry of `git worktree list`.
  if [ ! -e .env ]; then
    main="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
    [ -f "$main/.env" ] || die "no .env in main checkout ($main)"
    ln -s "$main/.env" .env
  fi

  : > "$LOGF"
  bun dev >>"$LOGF" 2>&1 &
  echo $! > "$PIDF"

  # Never assume :3000 — other worktrees hold it and Next silently takes the
  # next free port. Read the port Next actually chose.
  local base=""
  for _ in $(seq 1 60); do
    base=$(grep -oE 'http://localhost:[0-9]+' "$LOGF" | head -1)
    [ -n "$base" ] && break
    kill -0 "$(cat "$PIDF")" 2>/dev/null || { tail -5 "$LOGF" >&2; die "dev server exited"; }
    sleep 0.5
  done
  [ -n "$base" ] || { tail -5 "$LOGF" >&2; die "dev server never printed a URL"; }

  for _ in $(seq 1 60); do
    curl -sf -o /dev/null --max-time 2 "$base/login" && { echo "$base" > "$URLF"; return 0; }
    sleep 0.5
  done
  die "$base/login never answered 200"
}

ensure_login() {
  local base="$1" url
  # Reuse the warm agent-browser daemon if it is already on an authed page.
  url=$(agent-browser get url 2>/dev/null || true)
  case "$url" in *"/dashboard"*) echo "verify: already signed in" >&2; return 0;; esac

  agent-browser open "$base/login" >/dev/null 2>&1 || die "agent-browser open failed (sandbox?)"
  # The login route is /login. /auth/login is a 404: src/app/(auth)/ is a route
  # group, and parentheses never appear in the URL.
  #
  # Match on text, not role. `find role button click "$DEV_LOGIN"` silently
  # clicks the FIRST button on the page (Sign in) — the trailing positional is
  # the action's input, not a name filter. Use `--name` or, as here, `find text`.
  agent-browser find text "$DEV_LOGIN" click >/dev/null 2>&1 \
    || die "no '$DEV_LOGIN' button — is this a production build?"
  agent-browser wait 3000 >/dev/null 2>&1

  url=$(agent-browser get url 2>/dev/null || true)
  case "$url" in *"/dashboard"*) ;; *) die "login did not reach /dashboard (at: ${url:-nothing})";; esac
}

case "${1:-up}" in
  up)
    if server_alive; then
      echo "verify: reusing server $(cat "$URLF")" >&2
    else
      start_server
    fi
    base="$(cat "$URLF")"
    ensure_login "$base"
    echo "$base"
    ;;
  down)
    agent-browser close --all >/dev/null 2>&1 || true
    [ -s "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null
    rm -rf "$STATE"
    echo "verify: down" >&2
    ;;
  *) die "usage: verify.sh [up|down]" ;;
esac
