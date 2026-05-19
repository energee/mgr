import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Escape SQL LIKE/ILIKE wildcard characters so they match literally.
 * Handles `%`, `_`, and `\` which have special meaning in LIKE patterns.
 * Use this when interpolating user input into `.ilike()` or `.like()` queries.
 */
export function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/**
 * Get current date/time formatted for datetime-local input.
 * Returns ISO string trimmed to minute precision (YYYY-MM-DDTHH:MM).
 */
export function getCurrentDateTimeLocal(): string {
  return new Date().toISOString().slice(0, 16);
}

