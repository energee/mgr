#!/usr/bin/env bash
# Apply-or-verify the two local patches autoharness needs to run campaigns
# (docs/agents/autoharness.md, "Local autoharness patches"). `pipx upgrade
# autoharness` silently reverts both, so run this after every install/upgrade.
# Idempotent; fails loudly when upstream code shifted and a pattern no longer
# matches, instead of leaving a half-patched venv.
set -euo pipefail

shopt -s nullglob
candidates=("$HOME"/.local/pipx/venvs/autoharness/lib/python3.*/site-packages/autoharness/campaign_handlers.py)
target="${candidates[0]-}"

if [ -z "$target" ]; then
  echo "ERROR: autoharness campaign_handlers.py not found under ~/.local/pipx/venvs/autoharness/." >&2
  echo "Install it first: pipx install autoharness" >&2
  exit 1
fi

python3 - "$target" <<'PY'
import sys

path = sys.argv[1]
with open(path) as handle:
    source = handle.read()
original = source
applied = []

# Patch 1: the default staging copies the whole repo into a staging dir that
# lives *inside* the repo, so the copy recurses into itself (20+ GB per
# iteration). "off" applies edits in place; autoharness's restore machinery
# still reverts them.
if 'staging_mode="off",' in source:
    pass
elif source.count('staging_mode="auto",') == 1:
    source = source.replace('staging_mode="auto",', 'staging_mode="off",')
    applied.append('staging_mode auto->off')
else:
    sys.exit(
        "FAIL: staging_mode pattern absent or ambiguous — upstream shifted; "
        "re-derive the patch per docs/agents/autoharness.md before running a campaign."
    )

# Patch 2: without `record = None` before the exit_code branch, any execution
# failure crashes the campaign with UnboundLocalError.
anchor = '            if exit_code != 0:\n                execution_error'
guarded = '            record = None\n' + anchor
if guarded in source:
    pass
elif source.count(anchor) == 1:
    source = source.replace(anchor, guarded)
    applied.append('record=None guard inserted')
else:
    sys.exit(
        "FAIL: exit_code anchor absent or ambiguous — upstream shifted; "
        "re-derive the patch per docs/agents/autoharness.md before running a campaign."
    )

if source != original:
    with open(path, 'w') as handle:
        handle.write(source)
    print('PATCHED: ' + ', '.join(applied))
else:
    print('OK: both patches already present')
PY

echo "autoharness venv ready: $target"
