/**
 * E2E smoke tests for the dashboard — F128 + F200 verification surface.
 *
 * Smoke level only, deliberately. Two deeper scaffolds used to sit here and
 * were REMOVED rather than implemented (issue #437, acceptance criterion 4);
 * the reasoning is recorded here because "we deleted a test" needs to survive
 * longer than a PR description.
 *
 * 1. "activity heatmap renders cells for the past 12 weeks" — the skip reason
 *    ("blocked on F200, still in_progress, nothing to assert against") had
 *    gone stale: F200 is `passing` in docs/feature_list.json, shipped
 *    2026-05-06 (PR #248) as `src/components/dashboard/batch-activity-heatmap
 *    .tsx`. The scaffold was also asserting a product that was never built —
 *    it wanted "~84 cells (12 weeks x 7 days)" and what shipped is a YEAR
 *    view, so implementing it literally would have encoded the wrong spec.
 *    What it wanted to prove is already proven closer to the logic:
 *    `heatmap-utils.test.ts` covers the count -> colour-bucket mapping
 *    (`bucketForCount`, 0/1/2/3/>=4 — scaffold step 4) and weekly bucketing
 *    including zero-filling weeks with no data (scaffold step 3), and
 *    `batch-activity-heatmap.test.tsx` covers RPC-error surfacing. The only
 *    uncovered step was "hover a cell -> tooltip shows date + count", which
 *    is `react-activity-calendar` rendering its own tooltip; that dependency
 *    has its own pinning test (`react-activity-calendar-dep.test.ts`), and
 *    browser-testing a vendor library's tooltip is not this suite's job.
 *
 * 2. "dashboard trends charts render with real data" — the original skip
 *    reason still holds and is itself the argument for deleting rather than
 *    implementing: these charts aggregate over the WHOLE database, so with
 *    `fullyParallel` any assertion on their contents depends on what other
 *    specs have seeded and not yet cleaned up. That is a direct conflict with
 *    criterion 3 (deterministic, repeatable, parallel-safe), and the only
 *    fixes are serialising the suite or giving this one spec its own database.
 *    Meanwhile the failure that actually reached users — MGR-K / Sentry
 *    7597067731, where a failed RPC rendered as a silently-empty chart — is
 *    covered by `src/app/(app)/dashboard/__tests__/production-trends.test.tsx`,
 *    which asserts an explicit error state. A "chart has >= 1 data point" E2E
 *    assertion would not have caught that bug at all: it cannot tell "the
 *    fetch failed" from "there is no data".
 *
 * If dashboard rendering ever needs real end-to-end coverage, it needs a
 * dedicated database per run first — not a re-added skip.
 */
import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("dashboard root renders", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("body")).toContainText(/dashboard/i);
  });

  test("inventory dashboard renders", async ({ page }) => {
    await page.goto("/dashboard/inventory");
    await expect(page.locator("body")).toContainText(/inventory/i);
  });

  test("sales dashboard renders", async ({ page }) => {
    await page.goto("/dashboard/sales");
    await expect(page.locator("body")).toContainText(/sales/i);
  });
});
