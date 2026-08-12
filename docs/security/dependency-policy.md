# Dependency vulnerability policy

MGR treats high- and critical-severity advisories in `bun.lock` as release blockers. The Test workflow runs `bun audit --audit-level=high` after a frozen install in its `Production Build` job, which is scheduled (weekday nightly against `main`) and `workflow_dispatch`-only — not per pull request. The command must exit successfully.

Because the gate is nightly rather than per-PR, a dependency advisory published after a merge surfaces as a red *nightly* rather than a red PR, and it surfaces on the `Production Build` job. Downstream jobs that declare `needs: build` (E2E) then report as **skipped**, not failed — so "nightly E2E skipped" is a symptom of this gate failing, not of an E2E problem. Check the `Production Build` job first.

The gate covers production and development dependencies, including transitive packages. Production findings take priority, but build and test tooling remains in scope because it processes repository-controlled and pull-request-controlled input in CI.

Routine dependency updates should be reviewed at least monthly. High and critical advisories are handled immediately through the blocking pull-request gate.

## 2026-07-15 high-severity triage

The issue #438 baseline contained 41 high advisory records. Several records referred to the same installed package and code path. All affected installed versions were upgraded, and `bun audit --audit-level=high` exited successfully with no ignored advisories *as of that date*. See "Active exceptions" below, which is the authoritative statement of the current suppression state.

| Dependency | Scope and reachability | Resolution |
|---|---|---|
| `next` | Production framework; reachable for every server request and rendered page. | Direct pin upgraded from 16.1.6 to 16.2.10. React and React DOM were upgraded to the compatible patch release. |
| `axios`, `form-data` | Production transitive dependencies of Square; reachable when MGR calls the Square integration and constructs outbound request bodies. | Exact patched transitive overrides. |
| `lodash-es` | Production transitive dependency of Mermaid/Streamdown; reachable while parsing and rendering AI markdown diagrams. | Exact patched transitive override. |
| `undici` | Mixed scope: development through jsdom and production through server-side DOM sanitization. | Exact patched transitive override. |
| `fast-uri` | Build-time transitive dependency of Sentry/Webpack schema validation; not shipped as an application request handler. | Exact patched transitive override. |
| `rollup` | Build and test tooling through Sentry and Vite; reachable while bundling repository or pull-request-controlled source. | Exact patched transitive override. |
| `flatted` | Development-only ESLint cache serialization; reachable during static analysis. | Exact patched transitive override. |
| `vite` | Development and test tooling; reachable while running Vitest and the development toolchain. | Exact patched transitive override. |
| `ws` | Development-only bundle analyzer transport; reachable only during analyzer builds. | Exact patched transitive override. |
| `minimatch` | Development/build transitive dependency of ESLint, TypeScript ESLint, and Sentry tooling; reachable while matching repository paths. | Lockfile refreshed to patched 3.x and 9.x releases while preserving the separate 10.x line. |
| `picomatch` | Development/build transitive dependency of Rollup, Vite, ESLint tooling, and micromatch; reachable while matching repository paths. | Lockfile refreshed to patched 2.x and 4.x releases. |

## 2026-07-29 high-severity triage

The nightly scheduled Test run had failed on the `Production Build` job every night since 2026-07-26 (runs 30246046597, 30337135158, 30430549740). The failing step was this gate: 8 high advisories across 4 installed packages. E2E reported as *skipped* rather than failed because it declares `needs: build`, which made the nightly look like an E2E problem rather than an audit one.

Seven of the eight were cleared by patching. The eighth has no compatible patched release and is recorded as a dated exception below.

| Dependency | Scope and reachability | Resolution |
|---|---|---|
| `fast-uri` | Build-time transitive dependency of ESLint and Sentry/Webpack schema validation (`ajv`); not shipped as an application request handler. | Existing exact override advanced 3.1.2 → 3.1.4. Clears GHSA-4c8g-83qw-93j6 and GHSA-v2hh-gcrm-f6hx. |
| `postcss` | Mixed scope: production CSS pipeline through `next` and `@tailwindcss/postcss`, plus development/test through Vite and Vitest. Reachable while compiling repository-controlled stylesheets. | New exact override 8.5.25. `next` pins `postcss` to exactly 8.4.31, so no direct bump can move it; Next.js 16.3 canary itself has already adopted the 8.5.x line, which is the compatibility basis for the override. Clears GHSA-6g55-p6wh-862q and GHSA-r28c-9q8g-f849. |
| `sharp` | Production optional dependency of `next`, used for image optimization by `next start`. Vercel serves image optimization from its own pipeline, so the bundled copy is reachable only for self-hosted rendering. | New exact override 0.35.3 (libvips CVE-2026-33327/33328/35590/35591). `next` 16.2.x declares `sharp: ^0.34.5`, which cannot reach 0.35.x; Next.js 16.3 canary declares `^0.35.3`, which is the compatibility basis. Requires Node >= 20.9, satisfied by this repo's `engines.node: >=24`. Clears GHSA-f88m-g3jw-g9cj. **Verified at runtime 2026-07-30** (not merely built): `next build` + `next start`, then `GET /_next/image?url=/<local>.png&w=32&q=75` returned `200`, `Content-Type: image/png`, and a body that `file(1)` identifies as `PNG image data, 32 x 32` — i.e. Next 16.2.12 really does drive sharp 0.35.3's API and resize through it, despite the declared-range mismatch. A remote `url=` returned `400` as expected, since no `images.remotePatterns` are configured. |
| `brace-expansion` | Development/build-only, through the ESLint plugin set and Sentry's `glob`; reachable while matching repository-controlled paths during lint and bundling. | Lockfile refreshed to patched releases on each major line in use — 1.1.12 → 1.1.17 (under `minimatch` 3.x) and 5.0.4 → 5.0.8 (under `minimatch` 10.x), each inside its parent's declared range. Clears both GHSA-3jxr-9vmj-r5cp records. GHSA-mh99-v99m-4gvg was carried as a dated exception until 2026-08-11 — see "Resolved exceptions" below. |

`next` was deliberately left at 16.2.11. Dependabot PR #648 bumps it to 16.2.12, but 16.2.12 still pins `postcss` 8.4.31 and `sharp` `^0.34.5`, so it neither fixes nor conflicts with this triage.

Nested/scoped `overrides` (npm's `"minimatch@3": { … }` form) are **not** usable here: Bun 1.3.10 emits `warn: Bun currently does not support nested "overrides"` and ignores them. Per-major transitive pinning therefore has to be done in `bun.lock`, verified with `bun install --frozen-lockfile`.

## 2026-08-11 high-severity triage

Landed with the removal of the GHSA-mh99-v99m-4gvg exception (#653): `bun audit --audit-level=high` reported 4 high advisories across 4 installed packages, all published after the 2026-07-29 triage. All four had compatible patched releases, so no exception was needed.

| Dependency | Scope and reachability | Resolution |
|---|---|---|
| `undici` | Development through jsdom (and previously production through server-side DOM sanitization — the override predates this triage). | Existing exact override advanced 7.28.0 → 7.29.0. Clears GHSA-4cwx-7wf7-3272. |
| `fast-uri` | Build-time transitive dependency of ESLint and Sentry/Webpack schema validation (`ajv`); not shipped as an application request handler. | Existing exact override advanced 3.1.4 → 3.1.5. Clears GHSA-7p8r-x3mc-p8w7. |
| `nanoid` | Mixed scope: production through `next`/`postcss` and `@tailwindcss/postcss`, development/test through Vite and Vitest. | Lockfile refreshed to 3.3.18 within `postcss`'s declared `^3.3.11` range; no override needed. Clears GHSA-2v37-7h3g-55p8. |
| `js-yaml` | Development-only, through `@eslint/eslintrc`; parses repository-controlled YAML during lint. | Lockfile refreshed to 4.3.1 within the declared `^4.1.0` range; no override needed. Clears GHSA-5p4m-2wfm-xmqj. |

## 2026-08-12 high-severity triage

The nightly scheduled Test run had failed on the `Production Build` job every scheduled run from 2026-08-05 through 2026-08-11 (issue #735; runs 30983756151, 31086547981, 31158412724, 31368150372, 31468790698). The failing step was again this gate: 4 high advisories, each one patch release behind an already-pinned or previously-unpinned transitive package.

All four were cleared by patching; no exception was needed.

| Dependency | Scope and reachability | Resolution |
|---|---|---|
| `undici` | Mixed scope: development through `jsdom`, production through server-side DOM sanitization (`isomorphic-dompurify`). | Existing exact override advanced 7.28.0 → 7.29.0. Clears GHSA-4cwx-7wf7-3272 (cross-user cache-directive information disclosure and parse-time crash). |
| `fast-uri` | Build-time transitive dependency of ESLint and Sentry/Webpack schema validation (`ajv`); not shipped as an application request handler. | Existing exact override advanced 3.1.4 → 3.1.5. Clears GHSA-7p8r-x3mc-p8w7 (host confusion via backslash authority introducer). |
| `nanoid` | Development/build-only transitive dependency of `postcss` (itself overridden to 8.5.25), reachable through `next`, `@tailwindcss/postcss`, Vite, and Vitest while compiling repository-controlled stylesheets. | New exact override 3.3.17, inside `postcss@8.5.25`'s declared `^3.3.16` range. Clears GHSA-2v37-7h3g-55p8 (indefinite loop when a custom generator's `size` is zero). |
| `js-yaml` | Development-only transitive dependency of `@eslint/eslintrc`; reachable while ESLint parses its own config. | New exact override 4.3.1, inside `@eslint/eslintrc`'s declared `^4.3.0` range. Clears GHSA-5p4m-2wfm-xmqj (quadratic CPU consumption in `!!omap` resolution). |

Verified with `bun install` (regenerates `bun.lock` against the new overrides) and `make check` (lint, typecheck, unit tests, production build all green). `bun audit` itself could not be re-run in the environment that produced this fix — outbound access to its advisory endpoint was blocked there — so the fix instead confirms each installed version against the minimum patched version `bun audit` printed in the failing run's log.

## Remediation

1. Update the direct dependency that introduces the vulnerable package when a compatible release is available.
2. If the direct dependency has not refreshed a compatible transitive range, use a top-level `overrides` entry to select a patched version. Keep overrides exact, remove them when the parent dependency adopts the patch, and never force one version across incompatible major ranges. Refresh separate compatible lockfile entries for packages used across multiple major lines.
3. Run `bun install`, `bun audit --audit-level=high`, and `make check`. Commit `package.json` and `bun.lock` together.

The current overrides remediate compatible transitive packages introduced by Square, Sentry, Mermaid/Streamdown, ESLint, Vitest/Vite, jsdom, and the bundle analyzer. Next.js, React, and React DOM are pinned directly so framework security releases cannot drift between environments.

## GitHub Actions supply chain

The repository is public, so workflow dependencies are part of the attack surface. Trust basis, enforced by a contract test in `.github/scripts/ci-workflows.test.ts` ("pins all non-actions/* actions to full commit SHAs"):

- **`actions/*` namespace stays on version tags** (`actions/checkout@v7`, `actions/cache@v6`, `actions/upload-artifact@v7`). These are first-party, GitHub-maintained actions in a namespace GitHub controls; a tag hijack there implies a compromise of GitHub itself, which is already in our trust base. This is an explicit, recorded decision — not an oversight.
- **Every other action is pinned to a full 40-character commit SHA**, with the intended tag recorded as a trailing comment (e.g. `oven-sh/setup-bun@0c5077e5… # v2`). Third-party tags are mutable: a compromised maintainer account can re-point `v2` at malicious code and every consumer picks it up on the next run. A commit SHA cannot be silently re-pointed.
- **Dependabot keeps the SHAs current.** `.github/dependabot.yml` checks `github-actions` weekly and updates SHA pins (and their tag comments) the same way it bumps version tags, so pinning does not mean freezing.

## Exceptions

An exception is a temporary last resort when no compatible patch exists. Its pull request must add a dated record to this file containing:

- the CVE or GHSA identifier and affected package/version;
- whether the dependency is production or development-only and the reachable MGR code path;
- compensating controls and residual risk;
- an owner, linked follow-up issue, approval, and an expiry no more than 30 days away.

Only the documented advisory may then be passed with `bun audit --ignore <CVE>`. Broad severity suppression, `continue-on-error`, and undocumented ignores are prohibited. Remove the ignore and exception as soon as a compatible patched release is available.

Two contract tests in `.github/scripts/ci-workflows.test.ts` enforce the shape of this section: every id passed to `--ignore` must be a concrete GHSA/CVE identifier (never a bare flag, a severity, or a package name), and every such id must appear in this file. An ignore added without a record below fails CI.

## Active exceptions

There are no active exceptions.

## Resolved exceptions

### GHSA-mh99-v99m-4gvg — `brace-expansion` (added 2026-07-29, revised 2026-07-30, removed 2026-08-11)

The only exception this policy has carried. `brace-expansion@1.1.18` (the 1.x backport of the fix, pinned via `overrides` since 2026-07-30) was patched code the whole time, but the advisory expressed its vulnerable range as one flat `<= 5.0.7` spanning every major line, so audit tooling kept flagging it — the suppression was metadata-driven, not risk-driven. On 2026-08-11 the advisory's exit condition from the exception record was confirmed met: [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) now declares per-major-line ranges (`< 1.1.17`, `>= 2.0.0, < 2.1.3`, `>= 3.0.0, < 3.0.3`, `>= 4.0.0, < 5.0.8`), which exclude the installed `1.1.18`, and `bun audit` no longer reports it. `--ignore GHSA-mh99-v99m-4gvg` was removed from `.github/workflows/test.yml` the same day (#653). The `overrides` pin on `brace-expansion@1.1.18` stays until the ESLint 9 plugin chain stops pinning `minimatch` 3.x. Full scope/reachability analysis for the exception's lifetime is preserved in the git history of this file.
