"use client";

/**
 * SSR-safe persisted boolean flag ("1"/"0" in localStorage). The server
 * snapshot is `false` (no localStorage there), so the first client render
 * matches the SSR HTML and the stored value lands before paint via
 * useSyncExternalStore. Writes don't notify subscribers — callers read the
 * fresh value on their next render, which is all current consumers need.
 */
import { useCallback, useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};
const getServerSnapshot = () => false;

export function usePersistedFlag(
  key: string
): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    emptySubscribe,
    // Stable per key so React's snapshot caching applies instead of re-running
    // its store-sync layout effect every render.
    useCallback(() => localStorage.getItem(key) === "1", [key]),
    getServerSnapshot
  );
  const setValue = useCallback(
    (next: boolean) => localStorage.setItem(key, next ? "1" : "0"),
    [key]
  );
  return [value, setValue];
}
