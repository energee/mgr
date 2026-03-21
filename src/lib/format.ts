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
