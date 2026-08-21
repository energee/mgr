"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import type { PaginationState } from "@tanstack/react-table";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";

const STORAGE_PREFIX = "mgr:table-page-size";

/**
 * localStorage key for a given table. When `tableKey` is provided the
 * preference is stored per table (e.g. "mgr:table-page-size:orders"), so each
 * table instance remembers its own row count. Without a key it falls back to
 * the shared global preference for backward compatibility.
 */
function storageKey(tableKey?: string): string {
  return tableKey ? `${STORAGE_PREFIX}:${tableKey}` : STORAGE_PREFIX;
}

/**
 * Read page size from localStorage (safe for SSR).
 */
function getStoredPageSize(defaultSize: number, tableKey?: string): number {
  if (typeof window === "undefined") {
    return defaultSize;
  }
  const stored = localStorage.getItem(storageKey(tableKey));
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return defaultSize;
}

/**
 * Hook to persist a table's page size preference to localStorage indefinitely.
 * Returns the current page size and a setter that saves to localStorage.
 *
 * Pass a stable `tableKey` (e.g. the entity table name) to persist the choice
 * per table instance; each table then remembers its own row count independently.
 *
 * The stored value is applied in an effect, not a lazy `useState` initializer
 * (audit SENTRY-7477285482 / MGR-7): localStorage is unavailable during SSR,
 * so reading it during render produces the default on the server and the
 * stored value on the client's first (pre-hydration) render whenever a user
 * has previously changed their page size — a hydration mismatch. Deferring
 * the read to useEffect ensures both renders agree on `defaultSize` first.
 */
export function usePersistedPageSize(
  defaultSize = DEFAULT_PAGE_SIZE,
  tableKey?: string,
) {
  const [pageSize, setPageSizeState] = useState(defaultSize);

  useEffect(() => {
    // Unconditional write: when tableKey changes in place, the previous
    // table's size must not leak into a table with no stored preference
    // (setState with the current value is a no-op render-wise).
    setPageSizeState(getStoredPageSize(defaultSize, tableKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read on mount and key change, mirroring usePrefillHydration
  }, [tableKey]);

  // Setter that also persists to localStorage
  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeState(size);
      if (typeof window !== "undefined") {
        localStorage.setItem(storageKey(tableKey), String(size));
      }
    },
    [tableKey],
  );

  return { pageSize, setPageSize };
}

/**
 * Table pagination state whose pageSize is the persisted preference — the
 * single source of truth. `pagination` is DERIVED from the hook's pageSize
 * plus local pageIndex state, so the stored size is restored after mount by
 * construction (issue #859: entity-data-table previously copied the hook's
 * first-render value — always the default — into its own useState and never
 * synced back, so the preference persisted but was never restored on reload).
 *
 * `onPaginationChange` is a TanStack Table onPaginationChange handler: page
 * moves update pageIndex; size changes persist via setPageSize and snap back
 * to the first page (a stale pageIndex into a longer page would render an
 * empty page under server pagination).
 */
export function usePersistedPagination(defaultSize?: number, tableKey?: string) {
  // `undefined` falls through to usePersistedPageSize's own parameter
  // default — that layer is the single owner of DEFAULT_PAGE_SIZE.
  const { pageSize, setPageSize } = usePersistedPageSize(defaultSize, tableKey);
  const [pageIndex, setPageIndex] = useState(0);

  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex, pageSize }),
    [pageIndex, pageSize],
  );

  const onPaginationChange = useCallback(
    (updater: PaginationState | ((old: PaginationState) => PaginationState)) => {
      // Compute `next` from the render-captured pagination. Safe because
      // every producer (page flip, size select) is a discrete single-call
      // event that React flushes before the next can fire — not because the
      // useMemo would protect against same-batch updates.
      const next = typeof updater === "function" ? updater(pagination) : updater;
      if (next.pageSize !== pagination.pageSize) {
        setPageSize(next.pageSize);
        setPageIndex(0);
      } else {
        setPageIndex(next.pageIndex);
      }
    },
    [pagination, setPageSize],
  );

  const resetPageIndex = useCallback(() => setPageIndex(0), []);

  return { pagination, onPaginationChange, resetPageIndex };
}
