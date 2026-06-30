/**
 * useSuggestedNumber
 *
 * Fetches a suggested sequential document number once on mount (e.g.
 * "PO-2026-014" from generate_next_po_number()) for prefilling create-form
 * defaultValues. Used by /purchasing/pos/new and /sales/orders/new.
 *
 * Deliberately NOT react-query: a "next number" suggestion must be computed
 * fresh for every form mount — replaying a cached suggestion would hand two
 * forms the same number. Generator failures resolve to null (the form falls
 * back to manual entry) rather than blocking creation.
 */

import { useEffect, useState } from "react";

/**
 * @param generate async producer of the next number (module-level RPC
 *   wrapper — must be referentially stable across renders)
 * @param skip when true (e.g. the URL already carries the number via a deep
 *   link), no fetch is made and the hook resolves immediately with null
 * @returns `suggested` (null until fetched, or on skip/failure) and
 *   `resolved` (true once the form may mount — defaults are captured at form
 *   init, so callers should hold rendering until resolved)
 */
export function useSuggestedNumber(
  generate: () => Promise<string>,
  skip = false,
): { suggested: string | null; resolved: boolean } {
  const [suggested, setSuggested] = useState<string | null>(null);
  const [resolved, setResolved] = useState(skip);

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    generate()
      .then((value) => {
        if (!cancelled) setSuggested(value);
      })
      .catch(() => {
        // Already logged by the RPC wrapper; fall back to manual entry.
      })
      .finally(() => {
        if (!cancelled) setResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [generate, skip]);

  return { suggested, resolved };
}
