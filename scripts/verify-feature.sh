#!/usr/bin/env bash
# scripts/verify-feature.sh — Run the verification command for a single feature.
#
# Usage: bash scripts/verify-feature.sh F003
#        make verify-feature ID=F003
#
# Reads docs/feature_list.json, finds the entry with matching id, and runs
# its `verification` command. Prints the entry on success/failure for
# evidence capture.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/verify-feature.sh <FEATURE_ID>" >&2
  exit 1
fi

ID="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LIST="$REPO_ROOT/docs/feature_list.json"

if [ ! -f "$LIST" ]; then
  echo "ERROR: $LIST not found" >&2
  exit 1
fi

# Extract the feature entry. Use bun (jq is optional for users) — bun ships
# with the harness, jq does not.
#
# IDs and the list path are passed via environment variables, not interpolated
# into the JS source, so a feature ID containing a single quote can't break
# parsing or inject code. Mirror of scripts/feature-mark.ts.
FEATURE_JSON=$(FEATURE_ID="$ID" FEATURE_LIST="$LIST" bun -e '
const list = JSON.parse(require("fs").readFileSync(process.env.FEATURE_LIST, "utf8"));
const f = list.features.find(x => x.id === process.env.FEATURE_ID);
if (!f) { process.exit(2); }
console.log(JSON.stringify(f, null, 2));
')

if [ -z "$FEATURE_JSON" ]; then
  echo "ERROR: feature '$ID' not found in docs/feature_list.json" >&2
  exit 2
fi

echo "==> Feature $ID"
echo "$FEATURE_JSON"

VERIFICATION=$(echo "$FEATURE_JSON" | bun -e "
const f = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(f.verification ?? '');
")

case "$VERIFICATION" in
  "" | "null")
    echo
    echo "WARN: feature '$ID' has no verification defined (state: $(echo "$FEATURE_JSON" | bun -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).state)"))" >&2
    exit 3
    ;;
  "manual")
    # A manual feature only "passes" verification when its entry carries a
    # dated receipt: `last_verified` (ISO date) plus, ideally, `verified_by`
    # (a verify-skill transcript path or e2e spec path). Without a receipt
    # this exits 4 (UNVERIFIED) — printing INFO and exiting 0 let manual
    # features pass with zero observed behavior.
    LAST_VERIFIED=$(echo "$FEATURE_JSON" | bun -e "
const f = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(f.last_verified ?? '');
")
    VERIFIED_BY=$(echo "$FEATURE_JSON" | bun -e "
const f = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(f.verified_by ?? '');
")
    echo
    if [ -n "$LAST_VERIFIED" ]; then
      echo "OK: feature '$ID' is manual, verified $LAST_VERIFIED${VERIFIED_BY:+ by $VERIFIED_BY}."
      echo "    Re-walk the UI flow in user_visible_behavior if the receipt looks stale."
      exit 0
    fi
    echo "UNVERIFIED: feature '$ID' verification is 'manual' and has no dated receipt." >&2
    echo "  Walk the UI flow described in user_visible_behavior, then record the receipt in" >&2
    echo "  docs/feature_list.json: add \"last_verified\": \"YYYY-MM-DD\" and \"verified_by\":" >&2
    echo "  \"<verify-skill transcript path or e2e spec path>\" to the feature entry." >&2
    exit 4
    ;;
  *)
    echo
    echo "==> Running: $VERIFICATION"
    eval "$VERIFICATION"
    ;;
esac
