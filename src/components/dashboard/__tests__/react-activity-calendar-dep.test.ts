/**
 * Regression: MGR-4 — react-activity-calendar module not found
 *
 * Verifies that react-activity-calendar is installed and exports the symbols
 * used by batch-activity-heatmap.tsx. If the package is removed (e.g., by a
 * knip audit), this file fails to load and all tests here fail before any
 * other CI step can give a false-passing result.
 */

import { describe, it, expect } from "vitest";
import { ActivityCalendar } from "react-activity-calendar";

describe("react-activity-calendar (MGR-4 regression)", () => {
  it("exports ActivityCalendar as a valid React element type", () => {
    // React.memo/forwardRef wrappers are objects; plain components are functions.
    // Both are valid renderable types. A missing or renamed export would be undefined.
    expect(typeof ActivityCalendar === "function" || typeof ActivityCalendar === "object").toBe(true);
    expect(ActivityCalendar).not.toBeNull();
  });
});
