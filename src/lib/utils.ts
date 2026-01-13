import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a number as currency (USD).
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

/**
 * Format a date string for display.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

/**
 * Format a value for display based on its type.
 * Used by EntityList and EntityDetail for consistent formatting.
 */
export type ValueFormat = "date" | "datetime" | "currency" | "number" | "percentage" | "json" | "unit";

export function formatValue(
  value: unknown,
  format?: ValueFormat
): string {
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
      // Unit formatting requires additional context (unitType)
      // Fall through to default for now
      return String(value);
    default:
      if (typeof value === "boolean") return value ? "Yes" : "No";
      return String(value);
  }
}
