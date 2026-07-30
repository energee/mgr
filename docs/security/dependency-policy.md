# Dependency vulnerability policy

MGR treats high- and critical-severity advisories in `bun.lock` as release blockers. The Test workflow runs `bun audit --audit-level=high` after a frozen install in its `Production Build` job, which is scheduled (weekday nightly against `main`) and `workflow_dispatch`-only — not per pull request. The command must exit successfully.

Because the gate is nightly rather than per-PR, a dependency advisory published after a merge surfaces as a red *nightly* rather than a red PR, and it surfaces on the `Production Build` job. Downstream jobs that declare `needs: build` (E2E) then report as **skipped**, not failed — so "nightly E2E skipped" is a symptom of this gate failing, not of an E2E problem. Check the `Production Build` job first.

The gate covers production and development dependencies, including transitive packages. Production findings take priority, but build and test tooling remains in scope because it processes repository-controlled and pull-request-controlled input in CI.

Routine dependency updates should be reviewed at least monthly. High and critical advisories are handled immediately through the blocking pull-request gate.

## 2026-07-15 high-severity triage

The issue #438 baseline contained 41 high advisory records. Several records referred to the same installed package and code path. All affected installed versions were upgraded, and `bun audit --audit-level=high` exited successfully with no ignored advisories *as of that date*. One ignore has since been added — see "Active exceptions" below, which is the authoritative statement of the current suppression state.

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
| `brace-expansion` | Development/build-only, through the ESLint plugin set and Sentry's `glob`; reachable while matching repository-controlled paths during lint and bundling. | Lockfile refreshed to patched releases on each major line in use — 1.1.12 → 1.1.17 (under `minimatch` 3.x) and 5.0.4 → 5.0.8 (under `minimatch` 10.x), each inside its parent's declared range. Clears both GHSA-3jxr-9vmj-r5cp records. GHSA-mh99-v99m-4gvg is **not** cleared — see the exception below. |

`next` was deliberately left at 16.2.11. Dependabot PR #648 bumps it to 16.2.12, but 16.2.12 still pins `postcss` 8.4.31 and `sharp` `^0.34.5`, so it neither fixes nor conflicts with this triage.

Nested/scoped `overrides` (npm's `"minimatch@3": { … }` form) are **not** usable here: Bun 1.3.10 emits `warn: Bun currently does not support nested "overrides"` and ignores them. Per-major transitive pinning therefore has to be done in `bun.lock`, verified with `bun install --frozen-lockfile`.

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

### GHSA-mh99-v99m-4gvg — `brace-expansion` (added 2026-07-29, revised 2026-07-30, expires 2026-08-28)

- **Advisory and affected package:** [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), brace-expansion DoS via unbounded expansion length causing an out-of-memory process crash. Advisory vulnerable range `<= 5.0.7`, expressed as one flat range spanning every major line.
- **The installed code is patched (revised 2026-07-30).** The original record here claimed "first and only patched version 5.0.8, with no backport to the 1.x line" and named `1.1.17` as the newest 1.x release. Both were wrong within a day: **`brace-expansion@1.1.18` is a 1.x backport of the fix**, and `overrides` now pins it. Verified directly: the installed module contains `EXPANSION_MAX_LENGTH`/`EXPANSION_MAX`, and — critically, since this is what ruled 5.0.8 out — `require("brace-expansion")` still returns a **callable function** (`expand("a{b,c}")` → `["ab","ac"]`), so `minimatch` 3.x keeps working and `bun lint` exits 0.
- **Why the suppression stays anyway:** the advisory's range is a flat `<= 5.0.7`, which by semver comparison still matches `1.1.18`, and `npm audit` reports the only patched version as `5.0.9` (`isSemVerMajor: true`). So the tooling cannot express "1.x backport applied" and keeps flagging a dependency whose installed code is not vulnerable. **This suppression is now metadata-driven, not risk-driven** — that is the material change from the 2026-07-29 record.
- **Scope:** Development/build-only. Every requirer of `minimatch` 3.x in the tree is part of the ESLint 9 toolchain: `eslint@9.39.5` itself, `@eslint/config-array`, and `@eslint/eslintrc` pin `minimatch: ^3.1.5`, and `eslint-plugin-import@2.32.0`, `eslint-plugin-jsx-a11y@6.10.2`, `eslint-plugin-react@7.37.5` (all via `eslint-config-next`) pin `minimatch: ^3.1.2`. `minimatch` 3.x in turn requires `brace-expansion: ^1.1.7`. None of these appear in `dependencies` — all are `devDependencies` or their transitives. No production code path imports it, it is not bundled into the application, and it never processes end-user request data.
- **Reachable MGR code path:** `bun lint` only. The brace patterns expanded are the glob patterns written in `eslint.config.mjs` and the file paths ESLint walks — both repository-controlled. There is no path by which a runtime request, database row, or third-party API response reaches this parser.
- **Why no patch:** The three plugins are already at their latest published release and all still pin `minimatch` 3.x, so no direct-dependency bump reaches 5.0.8. A top-level `overrides` entry forcing 5.0.8 is prohibited (incompatible major ranges) and independently verified to break ESLint: `require("brace-expansion")` on 5.0.8 returns `{ EXPANSION_MAX, EXPANSION_MAX_LENGTH, expand }`, whereas `minimatch` 3.1.5 assigns the module directly and calls it as a function. Bumping `eslint` to 10.x was tried and reverted: ESLint 10 core does move to `minimatch: ^10.2.5` and drops `@eslint/eslintrc`, but the plugin-borne `minimatch@3` path survives, and all three plugins cap their `eslint` peer range at `^9` — so the bump buys a peer-range violation and no remediation.
- **Compensating controls:** The gate stays at `--audit-level=high` and suppresses this single id, so any new advisory on this or any other package still fails the build. Lint runs only on repository- and pull-request-controlled source in an ephemeral runner; the worst outcome is a crashed lint job, i.e. a failed check rather than a compromised deployment or data disclosure. Dependabot continues to open bumps for the plugin chain.
- **Residual risk:** Very low, and lower than the 2026-07-29 record stated. With `1.1.18` installed the DoS is patched in the code that actually runs; what remains is a suppressed advisory match, not an exposed parser. Even absent the patch the impact was a denial of service against our own CI lint step, triggerable only by a pattern someone can already commit or propose in a pull request — no confidentiality or integrity impact, no production exposure.
- **Owner:** @energee. **Follow-up issue:** #653. **Approval:** repository owner, via #639.
- **Expiry:** 2026-08-28 — 30 days from the 2026-07-29 record, the policy maximum. (The original said 2026-08-29, which is 31 days and therefore violated this document's own cap.) On expiry, re-check whether the advisory range has been narrowed to exclude the 1.x backport; if so, remove `--ignore GHSA-mh99-v99m-4gvg` from `.github/workflows/test.yml` and this record. Otherwise replace them with a fresh dated renewal.
