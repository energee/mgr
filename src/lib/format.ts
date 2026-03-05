/**
 * Shared formatting utilities used across reports, dashboards, and domain components.
 */

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

/** Format a number as USD currency. Returns "--" for null/undefined values. */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Format a barrel volume to two decimal places. Returns "--" for null/undefined values. */
export function formatBbl(value: number | null | undefined): string {
  if (value == null) return "--";
  return value.toFixed(2);
}
