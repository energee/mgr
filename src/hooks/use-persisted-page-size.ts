"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "mgr:table-page-size";
const DEFAULT_PAGE_SIZE = 10;

/**
 * Read page size from localStorage (safe for SSR).
 */
function getStoredPageSize(defaultSize: number): number {
  if (typeof window === "undefined") {
    return defaultSize;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return defaultSize;
}

/**
 * Hook to persist table page size preference to localStorage.
 * Returns the current page size and a setter that saves to localStorage.
 *
 * The stored value is applied in an effect, not a lazy `useState` initializer
 * (audit SENTRY-7477285482 / MGR-7): localStorage is unavailable during SSR,
 * so reading it during render produces the default on the server and the
 * stored value on the client's first (pre-hydration) render whenever a user
 * has previously changed their page size — a hydration mismatch. Deferring
 * the read to useEffect ensures both renders agree on `defaultSize` first.
 */
export function usePersistedPageSize(defaultSize = DEFAULT_PAGE_SIZE) {
  const [pageSize, setPageSizeState] = useState(defaultSize);

  useEffect(() => {
    const stored = getStoredPageSize(defaultSize);
    if (stored !== defaultSize) {
      setPageSizeState(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time read on mount, mirroring usePrefillHydration
  }, []);

  // Setter that also persists to localStorage
  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(size));
    }
  }, []);

  return { pageSize, setPageSize };
}
