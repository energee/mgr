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

# Path of the main checkout — always the first entry of `git worktree list`.
# substr(), not $2: awk field-splitting truncates paths containing spaces.
main_checkout() {
  git worktree list --porcelain | awk '/^worktree /{print substr($0, 10); exit}'
}

start_server() {
  # A recorded PID that is alive but slow to answer (server_alive's short curl
  # probe times out during a long Turbopack compile) must NOT trigger a second
  # boot — that would orphan the first server and leave it holding the port.
  # Wait for the live PID instead of re-booting over it.
  if [ -s "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then
    echo "verify: pid $(cat "$PIDF") alive but not answering yet — waiting, not re-booting" >&2
    for _ in $(seq 1 120); do
      server_alive && return 0
      sleep 1
    done
    die "existing server (pid $(cat "$PIDF")) never answered; run 'verify.sh down' first"
  fi

  # Worktrees carry only .env.example; the real .env lives in the main checkout.
  # `down` removes this symlink again (and only this symlink).
  if [ ! -e .env ]; then
    main="$(main_checkout)"
    [ -f "$main/.env" ] || die "no .env in main checkout ($main)"
    ln -s "$main/.env" .env
  fi

  : > "$LOGF"
  # Job control (set -m) puts the server in its own process group, so `down`
  # can kill the whole tree — `next dev` children outlive a kill on the bun
  # parent and keep holding the port.
  set -m
  bun dev >>"$LOGF" 2>&1 &
  echo $! > "$PIDF"
  set +m

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
  # Reuse the warm agent-browser daemon — but only if it is authed on THIS
  # app. Anchor the match to "$base": an unanchored */dashboard* would adopt
  # another worktree's dashboard on a different port and drive the wrong app.
  url=$(agent-browser get url 2>/dev/null || true)
  case "$url" in "$base"/dashboard*) echo "verify: already signed in" >&2; return 0;; esac

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
  case "$url" in "$base"/dashboard*) ;; *) die "login did not reach $base/dashboard (at: ${url:-nothing})";; esac
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
    # Close only the current browser session. `close --all` would tear down
    # every session in the shared agent-browser daemon, including other
    # worktrees'. Caveat: without AGENT_BROWSER_SESSION set, all worktrees
    # share the daemon's default session — export a unique value per worktree
    # for real isolation (see SKILL.md).
    agent-browser close >/dev/null 2>&1 || true
    if [ -s "$PIDF" ]; then
      pid="$(cat "$PIDF")"
      # start_server launched the server in its own process group (set -m);
      # kill the group so `next dev` children die with the bun parent. Fall
      # back to the single PID if the group kill fails.
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null
    fi
    # Remove the .env symlink `up` created — but only if it is still OUR
    # symlink (pointing at the main checkout's .env), never a file or link
    # the user placed themselves.
    if [ -L .env ] && [ "$(readlink .env)" = "$(main_checkout)/.env" ]; then
      rm -f .env
    fi
    rm -rf "$STATE"
    echo "verify: down" >&2
    ;;
  *) die "usage: verify.sh [up|down]" ;;
esac
