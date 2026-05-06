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
    echo
    echo "INFO: feature '$ID' verification is marked 'manual' — walk the UI flow described in user_visible_behavior."
    echo "      Mark passing in docs/feature_list.json once verified."
    exit 0
    ;;
  *)
    echo
    echo "==> Running: $VERIFICATION"
    eval "$VERIFICATION"
    ;;
esac
