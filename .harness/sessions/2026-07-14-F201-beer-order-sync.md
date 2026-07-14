# Session: F201 — Beer orders spreadsheet sync

- Started: 2026-07-14
- Branch: `feat/beer-order-sync`
- Starting commit: `6f2430c2`

## Plan

Add an admin-only upload, preview, mapping, atomic apply, and history workflow
under Settings → Integrations, using the repaired spreadsheet importer as the
behavioral baseline and never consulting MongoDB.

## Decisions

- Continue excluding In House/taproom blocks; internal stock belongs in bin allocations.
- Report spreadsheet orders missing from a later upload without deleting them.
- Store only server-authored plans and apply them by run ID in one SECURITY INVOKER RPC.
- Update stable deterministic line IDs in place so unchanged pick-list references survive.
- Use `read-excel-file`; it preserves cached string results in historical shared-formula cells.

## Verification log

- Focused parser, planner, API, and UI tests: passing (11 tests).
- Real workbook parser parity: 216 external orders / 1,205 source lines.
- Feature verifier, database security checks, lint, typecheck, test suite, and production build: passing.
- Read-only browser verification: upload page, source rules, disabled initial apply path, history failure state, and Retry action render correctly.
- Hosted mutation verification: intentionally not run because preview/apply persist production data and migration `00250` is not installed in the hosted database.

## Outcome

- Ending commit: this feature commit
- Feature state: passing
- Followups: deploy migration `00250` through `scripts/db-push.sh` with `SUPABASE_DB_URL`, then smoke-test preview/apply against the hosted database.
