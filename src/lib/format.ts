/** Format a number as USD currency (e.g., "$12.50"). Returns em-dash for null/undefined. */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "\u2014";
  return `$${Number(value).toFixed(2)}`;
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
