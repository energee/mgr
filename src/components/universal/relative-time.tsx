"use client";

/**
 * RelativeTime
 *
 * Render a time-dependent string after hydration to avoid SSR / CSR
 * mismatches without scattering `suppressHydrationWarning` across the
 * codebase. Addresses audit finding F-091.
 *
 * SSR (and the first client render) emits the `fallback`. After hydration
 * the formatted value is rendered, triggering a single benign re-render.
 *
 * Usage:
 *   <RelativeTime value={notification.created_at} format={(d) => formatRelative(d)} />
 *   <RelativeTime value="now" format={(d) => format(d, "EEEE, MMM d")} />
 *
 * The `format` callback is invoked once per parent render after hydration.
 * It does not need to be wrapped in `useCallback` — the component re-renders
 * only when its parent does, same as any other prop.
 */

import { useSyncExternalStore, type ReactNode } from "react";

type RelativeTimeProps = {
  /** ISO date string, Date, or the literal "now" for the live current time. */
  value: string | Date | "now";
  /** Formatter applied on the client after hydration. */
  format: (date: Date) => string;
  /** Fallback rendered during SSR + before hydration. Defaults to empty. */
  fallback?: ReactNode;
  /** Class passed to the wrapping time element. */
  className?: string;
};

const NO_SUBSCRIBE = () => () => {};

/**
 * `true` on the client after hydration, `false` on the server and during
 * the initial SSR-matching render. Lets components branch on "are we
 * hydrated?" without an effect.
 */
function useIsHydrated(): boolean {
  return useSyncExternalStore(
    NO_SUBSCRIBE,
    () => true,
    () => false,
  );
}

export function RelativeTime({
  value,
  format,
  fallback = "",
  className,
}: RelativeTimeProps) {
  const hydrated = useIsHydrated();
  if (!hydrated) {
    const isoValue =
      value === "now"
        ? undefined
        : value instanceof Date
          ? value.toISOString()
          : value;
    return (
      <time dateTime={isoValue} className={className}>
        {fallback}
      </time>
    );
  }
  const date =
    value === "now"
      ? new Date()
      : value instanceof Date
        ? value
        : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <time className={className}>{fallback}</time>;
  }
  return (
    <time dateTime={date.toISOString()} className={className}>
      {format(date)}
    </time>
  );
}
