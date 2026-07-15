"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_PREFIX = "mgr:table-page-size";
const DEFAULT_PAGE_SIZE = 25;

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
    const stored = getStoredPageSize(defaultSize, tableKey);
    if (stored !== defaultSize) {
      setPageSizeState(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time read on mount, mirroring usePrefillHydration
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
