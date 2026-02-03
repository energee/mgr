"use client";

import { useState, useCallback } from "react";

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
 */
export function usePersistedPageSize(defaultSize = DEFAULT_PAGE_SIZE) {
  // Lazy initialization - reads from localStorage only once on mount
  const [pageSize, setPageSizeState] = useState(() =>
    getStoredPageSize(defaultSize)
  );

  // Setter that also persists to localStorage
  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(size));
    }
  }, []);

  return { pageSize, setPageSize };
}
