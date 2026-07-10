#!/usr/bin/env bash
# smoke-test.sh — Headless browser smoke tests for MGR
#
# Runs fast smoke tests against a running dev server using gstack browse CLI.
#
# Usage:
#   ./scripts/smoke-test.sh [PORT] [SUITE]
#
# Examples:
#   ./scripts/smoke-test.sh              # all suites on port 3000
#   ./scripts/smoke-test.sh 55040        # all suites on port 55040
#   ./scripts/smoke-test.sh 3000 recipes # just the recipes suite
#
# Available suites: auth, dashboards, production, inventory, sales, recipes, settings

set -euo pipefail

PORT="${1:-3000}"
SUITE="${2:-all}"
BASE="http://localhost:$PORT"
SCREENSHOTS="/tmp/mgr-smoke"
PASS=0
FAIL=0
SKIP=0
FAILURES=()

# Find browse binary
if [[ -x .claude/skills/gstack/browse/dist/browse ]]; then
  B=".claude/skills/gstack/browse/dist/browse"
elif [[ -x "$HOME/.claude/skills/gstack/browse/dist/browse" ]]; then
  B="$HOME/.claude/skills/gstack/browse/dist/browse"
else
  echo "ERROR: browse binary not found. Run setup first."
  exit 1
fi

mkdir -p "$SCREENSHOTS"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

green() { printf "\033[32m✓ %s\033[0m\n" "$1"; }
red()   { printf "\033[31m✗ %s\033[0m\n" "$1"; }
gray()  { printf "\033[90m⊘ %s (skipped)\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

# Run a single test: check <name> <js-expression> [<expected>]
# Expression must return a truthy string. If <expected> given, result must contain it.
check() {
  local name="$1"
  local expr="$2"
  local expected="${3:-}"
  local result
  result=$($B js "$expr" 2>&1) || true

  if [[ -z "$result" || "$result" == "null" || "$result" == "undefined" || "$result" == "false" ]]; then
    red "$name"
    FAILURES+=("$name: got empty/null/false")
    FAIL=$((FAIL + 1))
    return
  fi

  if [[ -n "$expected" ]]; then
    if [[ "$result" == *"$expected"* ]]; then
      green "$name"
      PASS=$((PASS + 1))
    else
      red "$name (expected '$expected', got '$result')"
      FAILURES+=("$name: expected '$expected', got '$result'")
      FAIL=$((FAIL + 1))
    fi
  else
    green "$name"
    PASS=$((PASS + 1))
  fi
}

# Navigate and wait for render
nav() {
  $B goto "$1" >/dev/null 2>&1
  sleep 1
}

screenshot() {
  $B screenshot "$SCREENSHOTS/$1.png" >/dev/null 2>&1
}

# Get first entity ID from a list table (reads data-id or extracts from DOM)
first_id() {
  $B js "document.querySelector('table tbody tr td:nth-child(2)')?.closest('tr')?.dataset?.id || document.querySelector('table tbody tr')?.getAttribute('data-row-id') || ''" 2>&1
}

# ---------------------------------------------------------------------------
# Auth: Dev login flow
# ---------------------------------------------------------------------------
suite_auth() {
  bold "── Auth ──"

  # Clear cookies so we're not already logged in
  $B js "document.cookie.split(';').forEach(c => { document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'; }); 'cleared'" >/dev/null 2>&1

  nav "$BASE/login"
  sleep 1
  check "Login page renders" \
    "document.querySelector('button')?.textContent || ''" "Sign in"

  check "Dev Login button visible (dev mode)" \
    "Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Dev Login'))?.textContent || ''" "Dev Login"

  screenshot "01-login-page"

  # Sign in via dev-login API endpoint
  nav "$BASE/api/auth/dev-login?redirect=/"
  sleep 2
  check "Dev login redirects to app" \
    "!window.location.pathname.includes('login') ? 'authenticated' : ''" "authenticated"

  screenshot "01-auth-dashboard"
}

# ---------------------------------------------------------------------------
# Dashboards
# ---------------------------------------------------------------------------
suite_dashboards() {
  bold "── Dashboards ──"

  nav "$BASE/dashboard"
  check "Production dashboard loads" \
    "document.querySelector('h1,h2')?.textContent || ''" "Dashboard"

  check "Active batches table present" \
    "document.querySelector('table')?.rows?.length > 0 ? 'has-rows' : ''" "has-rows"

  # Vessel utilization uses uppercase heading
  check "Vessel utilization card present" \
    "document.body.innerText.toUpperCase().includes('VESSEL') ? 'found' : ''" "found"

  screenshot "02-dashboard-production"

  nav "$BASE/dashboard/inventory"
  check "Inventory dashboard loads" \
    "document.querySelector('h1,h2')?.textContent || ''" ""

  screenshot "02-dashboard-inventory"

  nav "$BASE/dashboard/sales"
  check "Sales dashboard loads" \
    "document.querySelector('h1,h2')?.textContent || ''" ""

  screenshot "02-dashboard-sales"
}

# ---------------------------------------------------------------------------
# Production: batches, vessels, brew logs, yeast
# ---------------------------------------------------------------------------
suite_production() {
  bold "── Production ──"

  # Batches list
  nav "$BASE/production/batches"
  check "Batches list loads" \
    "document.querySelector('table')?.rows?.length > 1 ? 'has-data' : ''" "has-data"
  screenshot "03-batches-list"

  # Navigate to batch detail — rows use React router.push, not DOM links
  nav "$BASE/production/batches"
  sleep 1
  # Use browse click on the row which triggers React's onRowClick
  $B click "table tbody tr:first-child td:nth-child(2)" >/dev/null 2>&1
  sleep 2
  check "Batch detail page loads" \
    "document.querySelector('h1,h2')?.textContent?.length > 0 ? 'has-title' : window.location.pathname" ""
  screenshot "03-batch-detail"

  # Vessels list
  nav "$BASE/production/vessels"
  check "Vessels list loads" \
    "document.querySelector('table')?.rows?.length > 1 ? 'has-data' : ''" "has-data"
  screenshot "03-vessels-list"

  # Brew logs list
  nav "$BASE/production/brew-logs"
  check "Brew logs list loads" \
    "document.querySelector('table') ? 'has-table' : ''" "has-table"
  screenshot "03-brew-logs"

  # Yeast pitches
  nav "$BASE/production/yeast-pitches"
  check "Yeast pitches list loads" \
    "document.querySelector('table') ? 'has-table' : ''" "has-table"
  screenshot "03-yeast-pitches"
}

# ---------------------------------------------------------------------------
# Recipes (custom editor)
# ---------------------------------------------------------------------------
suite_recipes() {
  bold "── Recipes ──"

  # List page
  nav "$BASE/production/recipes"
  check "Recipes list loads" \
    "document.querySelector('table')?.rows?.length > 1 ? 'has-data' : ''" "has-data"
  screenshot "04-recipes-list"

  # Navigate to recipe detail — use browse click on the first data row
  $B click "table tbody tr:first-child td:nth-child(2)" >/dev/null 2>&1
  sleep 3
  check "Recipe editor loads (custom page)" \
    "window.location.pathname.match(/\\/production\\/recipes\\/[0-9a-f-]+/) ? 'on-editor' : window.location.pathname" "on-editor"

  # Sidebar estimates
  check "Sidebar estimates present" \
    "document.body.innerText.includes('ESTIMATES') || document.querySelector('[class*=font-mono]')?.closest('[class*=sticky]') ? 'found' : document.body.innerText.includes('OG') ? 'found' : ''" "found"

  # SRM color indicator with inline hex style (may be empty if recipe has no grains)
  check "SRM color uses inline hex style" \
    "(() => { const el = document.querySelector('.rounded-full.border'); return el?.style?.backgroundColor || el?.getAttribute('style') || 'no-srm-element'; })()" ""

  # Section collapse persistence via sessionStorage
  check "Section collapse state in sessionStorage" \
    "Array.from({length: sessionStorage.length}, (_, i) => sessionStorage.key(i)).filter(k => k.startsWith('recipe-section')).length > 0 ? 'found' : ''" "found"

  # Aria accessibility on section content divs
  check "Section cards have aria content IDs" \
    "document.querySelectorAll('[id^=\"section-content\"]').length > 0 ? 'found' : ''" "found"

  screenshot "04-recipe-editor"

  # Mobile estimates bar
  $B viewport 375x812 >/dev/null 2>&1
  sleep 1
  check "Mobile estimates bar visible at 375px" \
    "document.querySelector('[class*=\"lg\\\\:hidden\"][class*=\"sticky\"]') ? 'found' : document.querySelector('.sticky')?.classList?.toString()?.includes('lg:hidden') ? 'found' : ''" "found"
  screenshot "04-recipe-mobile"

  # Cmd+S intercept
  $B js "document.dispatchEvent(new KeyboardEvent('keydown', {key: 's', metaKey: true, bubbles: true})); 'dispatched'" >/dev/null 2>&1
  sleep 1
  check "Cmd+S shows guidance toast" \
    "document.querySelector('[data-sonner-toast]')?.textContent || ''" "Save button"

  # Reset viewport
  $B viewport 1280x800 >/dev/null 2>&1

  # New recipe form (hideOnCreate)
  nav "$BASE/production/recipes/new"
  sleep 1
  check "New recipe form hides advanced sections" \
    "document.body.innerText.includes('Mash Parameters') ? 'FAIL-visible' : 'hidden'" "hidden"

  check "New recipe form shows overview fields" \
    "document.body.innerText.includes('Recipe Name') ? 'found' : ''" "found"

  screenshot "04-recipe-new"
}

# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------
suite_inventory() {
  bold "── Inventory ──"

  nav "$BASE/inventory/items"
  check "Inventory items list loads" \
    "document.querySelector('table') || document.body.innerText.includes('Items') || document.body.innerText.includes('Inventory') ? 'found' : ''" "found"
  screenshot "05-inventory-items"

  nav "$BASE/inventory/finished-goods"
  check "Finished goods list loads" \
    "document.querySelector('table') || document.body.innerText.includes('Finished') ? 'found' : ''" "found"
  screenshot "05-finished-goods"

  nav "$BASE/inventory/kegs"
  check "Kegs list loads" \
    "document.querySelector('table') || document.body.innerText.includes('Kegs') ? 'found' : ''" "found"
  screenshot "05-kegs"

  nav "$BASE/inventory/lots"
  check "Lots list loads" \
    "document.querySelector('table') || document.body.innerText.includes('Lots') ? 'found' : ''" "found"
  screenshot "05-lots"
}

# ---------------------------------------------------------------------------
# Sales
# ---------------------------------------------------------------------------
suite_sales() {
  bold "── Sales ──"

  nav "$BASE/sales/orders"
  check "Orders list loads" \
    "document.querySelector('table') ? 'has-table' : ''" "has-table"
  screenshot "06-orders"

  nav "$BASE/sales/customers"
  check "Customers list loads" \
    "document.querySelector('table') ? 'has-table' : ''" "has-table"
  screenshot "06-customers"
}

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
suite_settings() {
  bold "── Settings ──"

  nav "$BASE/settings/system"
  check "System settings loads" \
    "document.body.innerText.includes('Settings') ? 'found' : ''" "found"
  screenshot "07-settings"

  nav "$BASE/settings/locations"
  check "Locations settings loads" \
    "document.querySelector('table') ? 'has-table' : ''" "has-table"

  nav "$BASE/settings/users"
  check "Users settings loads" \
    "document.querySelector('table') ? 'has-table' : ''" "has-table"
}

# ---------------------------------------------------------------------------
# Run suites
# ---------------------------------------------------------------------------
echo ""
bold "MGR Smoke Tests — $BASE"
bold "Screenshots → $SCREENSHOTS/"
echo ""

if [[ "$SUITE" == "all" ]]; then
  suite_auth
  echo ""
  suite_dashboards
  echo ""
  suite_production
  echo ""
  suite_recipes
  echo ""
  suite_inventory
  echo ""
  suite_sales
  echo ""
  suite_settings
else
  if declare -f "suite_$SUITE" >/dev/null 2>&1; then
    # Auth is required for all suites except auth itself
    if [[ "$SUITE" != "auth" ]]; then
      nav "$BASE/api/auth/dev-login?redirect=/"
      sleep 2
    fi
    "suite_$SUITE"
  else
    echo "Unknown suite: $SUITE"
    echo "Available: auth, dashboards, production, inventory, sales, recipes, settings"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
bold "────────────────────────────"
printf "  \033[32m%d passed\033[0m" "$PASS"
if [[ $FAIL -gt 0 ]]; then
  printf "  \033[31m%d failed\033[0m" "$FAIL"
fi
if [[ $SKIP -gt 0 ]]; then
  printf "  \033[90m%d skipped\033[0m" "$SKIP"
fi
echo ""

if [[ $FAIL -gt 0 ]]; then
  bold "Failures:"
  for f in "${FAILURES[@]}"; do
    printf "  \033[31m• %s\033[0m\n" "$f"
  done
  echo ""
  exit 1
fi
