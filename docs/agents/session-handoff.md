# Session handoff template

Compact handoff at session end. Either update `PROGRESS.md` directly or
fill out a copy of this template in the PR body.

---

## Currently verified state

- **Branch**: `<branch>`
- **Latest commit**: `<sha>` — `<one-line message>`
- **Last gate run**: `make check` / `make check-all` — passed at `<timestamp>`

## Changes this session

- `<file>` — `<what changed and why>`
- `<file>` — `<what changed and why>`

## Known issues / blockers

- `<issue>` — `<status>`

## Next steps

1. `<numbered next action>`
2. `<numbered next action>`

## Command reference

```bash
make dev           # start dev server
make check         # pre-commit gate
make check-all     # PR gate (incl. E2E)
```
