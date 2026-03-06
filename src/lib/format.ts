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

/** Format a barrel volume to two decimal places. Returns "--" for null/undefined values. */
export function formatBbl(value: number | null | undefined): string {
  return formatDecimal(value);
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
