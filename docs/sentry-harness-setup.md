# Sentry Error Harness — Setup Guide

This document covers the one-time setup required before the Sentry Error
Harness workflow can run. See
[the design spec](./superpowers/specs/2026-04-16-sentry-error-harness-design.md)
and [the implementation plan](./superpowers/plans/2026-04-16-sentry-error-harness.md)
for context.

## Prerequisites

### 1. Create a Sentry project

1. Sign in at https://sentry.io (or your self-hosted instance).
2. Create a new project of type **Next.js**.
3. Copy the DSN from the "Client Keys" settings page.

### 2. Configure local Sentry reporting

1. Open `.env` at the repo root.
2. Add:

   ```
   NEXT_PUBLIC_SENTRY_DSN=https://<public-key>@o<org-id>.ingest.sentry.io/<project-id>
   ```

3. Restart `bun dev`. Trigger any error in the app (e.g., open a page that
   throws). Confirm the error appears in the Sentry dashboard within ~30
   seconds.

### 3. Create a Sentry auth token

The harness reads issues via the Sentry REST API.

1. In Sentry, go to **Settings → Account → User Auth Tokens**.
2. Create a token with scopes:
   - `project:read`
   - `event:read`
3. Copy the token value — it is shown only once.

### 4. Add GitHub repository secrets

Under **Settings → Secrets and variables → Actions** add:

| Name | Value |
|------|-------|
| `SENTRY_AUTH_TOKEN` | The user auth token from step 3 |
| `SENTRY_ORG` | Your Sentry org slug (e.g. `acme-brewing`) |
| `SENTRY_PROJECT` | Your Sentry project slug (e.g. `mgr`) |

`CLAUDE_CODE_OAUTH_TOKEN` is already configured for the existing Claude
Code workflows and is reused here.

### 5. (Optional) Create PR labels

The harness applies three labels to PRs it opens. GitHub auto-creates
labels on first use, but you can create them up front for consistent
colors.

- `sentry-fix` — applied to every harness PR
- `automated` — applied to every harness PR
- `needs-human` — applied to diagnostic PRs when the harness could not
  produce a working fix

## Verifying the harness

1. Go to **Actions → Sentry Error Harness → Run workflow** and start a
   manual dispatch.
2. The `score-errors` job should run to completion and log how many
   issues were scored. If no issues exist yet, the workflow ends green
   with `count: 0`.
3. Trigger a deliberate error in local dev to seed Sentry, wait a minute,
   then re-run the workflow. A `fix-error` job should spawn and open a
   PR.

## Scheduling

The workflow runs automatically each weekday at:

- `17:00 UTC` — noon EST

(Reduced from twice daily on 2026-07-16 to stay inside the 3,000
Actions-minutes allowance; each run also caps at 3 fix jobs. Use manual
dispatch for urgent off-schedule runs.)

DST transitions shift the local run time by one hour. Acceptable for this
use case.

## Troubleshooting

- **`401 Unauthorized` from Sentry** — the auth token is missing scopes
  or expired. Regenerate with `project:read` + `event:read`.
- **No issues found, but Sentry dashboard shows errors** — confirm
  `SENTRY_ORG` and `SENTRY_PROJECT` slugs. Verify the environment tag
  on your errors matches `SENTRY_ENVIRONMENT` in the workflow (defaults
  to `development`).
- **`fix-error` opens a PR labeled `needs-human`** — the harness
  could not produce a working fix after 3 attempts. Read the PR body for
  the root-cause analysis and finish manually.
- **Duplicate PRs across runs** — this should not happen. If it does,
  check that open PRs use the exact branch format
  `sentry-fix/SENTRY-<numeric-issue-id>`; any variation will break
  dedup. Dedup also skips issues whose latest merged `sentry-fix/` PR
  is newer than the issue's `lastSeen` — Sentry keeps issues
  "unresolved" until resolved by hand, so a merged fix would otherwise
  be re-picked every run. An issue that recurs after its fix merged
  becomes eligible again.
- **`400: Invalid stats_period`** — Sentry's project issues endpoint
  only accepts `''`, `24h`, and `14d` for `statsPeriod` (it rejected
  the harness's original `7d` starting June 2026). The default lives
  in `buildIssuesUrl` in `.github/scripts/sentry-harness/sentry-api.ts`.
