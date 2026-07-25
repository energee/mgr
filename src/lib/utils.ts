import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Get current date/time formatted for datetime-local input.
 * Returns ISO string trimmed to minute precision (YYYY-MM-DDTHH:MM).
 */
export function getCurrentDateTimeLocal(): string {
  return new Date().toISOString().slice(0, 16);
}

