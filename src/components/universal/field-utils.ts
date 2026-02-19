/**
 * Shared utilities for universal field components (FieldDisplay, FieldInput).
 */

// Map of colSpan values to responsive Tailwind classes.
// Full width on mobile, specified colSpan on md+ breakpoint.
const COL_SPAN_CLASSES: Record<number, string> = {
  1: "col-span-6 md:col-span-1",
  2: "col-span-6 md:col-span-2",
  3: "col-span-12 md:col-span-3",
  4: "col-span-12 md:col-span-4",
  6: "col-span-12 md:col-span-6",
  8: "col-span-12 md:col-span-8",
  12: "col-span-12",
};

const DEFAULT_COL_CLASS = "col-span-12 md:col-span-6";

/**
 * Resolve a field's colSpan (or fullWidth flag) to the appropriate
 * responsive Tailwind grid class string.
 */
export function getColSpanClass(colSpan?: number, fullWidth?: boolean): string {
  const span = fullWidth ? 12 : (colSpan || 6);
  return COL_SPAN_CLASSES[span] || DEFAULT_COL_CLASS;
}
