/**
 * Shared formatting utilities used across reports, dashboards, and domain components.
 */

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyFmtWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Format a number as USD currency. Returns "--" for null/undefined. Use decimals=0 for whole-dollar display. */
export function formatCurrency(value: number | null | undefined, decimals: 0 | 2 = 2): string {
  if (value == null) return "--";
  return (decimals === 0 ? currencyFmtWhole : currencyFmt).format(value);
}

/** Format a number to a fixed number of decimal places. Returns "--" for null/undefined. */
export function formatDecimal(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "--";
  return value.toFixed(decimals);
}

/**
 * Format a number rounded to the nearest hundredth, dropping unnecessary trailing zeros.
 * e.g. 7 → "7", 7.5 → "7.5", 7.125 → "7.13", 7.10 → "7.1"
 * Returns "--" for null/undefined.
 */
export function formatSmartDecimal(value: number | null | undefined, maxDecimals = 2): string {
  if (value == null) return "--";
  // Round to maxDecimals, then drop trailing zeros
  return parseFloat(value.toFixed(maxDecimals)).toString();
}

/** Format a barrel volume, showing decimals only when necessary (max 2). Returns "--" for null/undefined values. */
export function formatBbl(value: number | null | undefined): string {
  return formatSmartDecimal(value);
}

export function formatDate(
  date: Date | string | number | undefined,
  opts: Intl.DateTimeFormatOptions = {},
) {
  if (!date) return "";

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: opts.month ?? "long",
      day: opts.day ?? "numeric",
      year: opts.year ?? "numeric",
      ...opts,
    }).format(new Date(date));
  } catch {
    return "";
  }
}

export type ValueFormat = "date" | "datetime" | "currency" | "number" | "percentage" | "json" | "unit";

/** Format an unknown value for display in tables and detail views. */
export function formatValue(value: unknown, format?: ValueFormat): string {
  if (value === null || value === undefined) return "—";

  switch (format) {
    case "date":
      return new Date(value as string).toLocaleDateString();
    case "datetime":
      return new Date(value as string).toLocaleString();
    case "currency":
      return `$${(value as number).toFixed(2)}`;
    case "number":
      return (value as number).toLocaleString();
    case "percentage":
      return `${value}%`;
    case "json":
      return JSON.stringify(value, null, 2);
    case "unit":
      return String(value);
    default:
      if (typeof value === "boolean") return value ? "Yes" : "No";
      return String(value);
  }
}

/** Parse a string to an integer, returning null for empty/whitespace strings. */
export function parseIntOrNull(value: string): number | null {
  return value.trim() ? parseInt(value, 10) : null;
}

/**
 * Parse a string to a finite positive number, returning null when the value
 * is empty, non-numeric, zero, negative, or non-finite. Useful for form
 * fields that only accept strictly positive quantities.
 */
export function parsePositiveNumber(value: string): number | null {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
