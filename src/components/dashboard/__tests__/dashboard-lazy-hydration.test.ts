// Regression: MGR-6 (SENTRY-7477285440) — TrendChartLazy and
// BatchActivityHeatmapLazy used next/dynamic({ ssr: false }), which wraps an
// implicit Suspense boundary around a client-only bailout. Both are rendered
// inside ProductionTrends/SalesTrends, which are themselves inside a Suspense
// boundary that genuinely suspends (usePeriod() -> useSearchParams()).
// Nesting a dynamic(ssr:false) boundary inside another suspending boundary
// caused a hydration mismatch on /dashboard — the same class of bug already
// fixed for ChatLayout's ChatPanel (see chat-layout-hydration.test.ts). The
// fix replaces next/dynamic with React.lazy + an explicit <Suspense> pinned
// at the call site.
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const TREND_CHART_LAZY = readFileSync(
  resolve(__dirname, "../trend-chart-lazy.tsx"),
  "utf-8"
);
const HEATMAP_LAZY = readFileSync(
  resolve(__dirname, "../batch-activity-heatmap-lazy.tsx"),
  "utf-8"
);
const DASHBOARD_PAGE = readFileSync(
  resolve(__dirname, "../../../app/(app)/dashboard/page.tsx"),
  "utf-8"
);
const SALES_DASHBOARD_PAGE = readFileSync(
  resolve(__dirname, "../../../app/(app)/dashboard/sales/page.tsx"),
  "utf-8"
);

describe("dashboard lazy chart hydration guard (MGR-6 regression)", () => {
  it("TrendChartLazy does not use next/dynamic", () => {
    expect(TREND_CHART_LAZY).not.toMatch(/from ["']next\/dynamic["']/);
  });

  it("TrendChartLazy uses React.lazy", () => {
    expect(TREND_CHART_LAZY).toMatch(/\blazy\s*\(/);
  });

  it("BatchActivityHeatmapLazy does not use next/dynamic", () => {
    expect(HEATMAP_LAZY).not.toMatch(/from ["']next\/dynamic["']/);
  });

  it("BatchActivityHeatmapLazy uses React.lazy", () => {
    expect(HEATMAP_LAZY).toMatch(/\blazy\s*\(/);
  });

  it("dashboard page wraps BatchActivityHeatmapLazy in an explicit Suspense", () => {
    const withoutWhitespace = DASHBOARD_PAGE.replace(/\s+/g, " ");
    expect(withoutWhitespace).toMatch(
      /<Suspense fallback=\{[^}]*\}> <BatchActivityHeatmapLazy/
    );
  });

  it("dashboard page wraps TrendChartLazy in an explicit Suspense", () => {
    const withoutWhitespace = DASHBOARD_PAGE.replace(/\s+/g, " ");
    expect(withoutWhitespace).toMatch(
      /<Suspense fallback=\{[^}]*\}> <TrendChartLazy/
    );
  });

  it("sales dashboard page wraps both TrendChartLazy usages in an explicit Suspense", () => {
    const withoutWhitespace = SALES_DASHBOARD_PAGE.replace(/\s+/g, " ");
    const matches = withoutWhitespace.match(
      /<Suspense fallback=\{[^}]*\}> <TrendChartLazy/g
    );
    expect(matches).toHaveLength(2);
  });
});
