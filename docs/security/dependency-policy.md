# Dependency vulnerability policy

MGR treats high- and critical-severity advisories in `bun.lock` as release blockers. The Test workflow runs `bun audit --audit-level=high` after a frozen install on every pull request and push to `main`; the command must exit successfully.

The gate covers production and development dependencies, including transitive packages. Production findings take priority, but build and test tooling remains in scope because it processes repository-controlled and pull-request-controlled input in CI.

Routine dependency updates should be reviewed at least monthly. High and critical advisories are handled immediately through the blocking pull-request gate.

## 2026-07-15 high-severity triage

The issue #438 baseline contained 41 high advisory records. Several records referred to the same installed package and code path. All affected installed versions were upgraded; `bun audit --audit-level=high` now exits successfully with no ignored advisories.

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

There are no active exceptions.
