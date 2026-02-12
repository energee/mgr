"use client";

import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  // navigator.userAgent never changes, so no subscription needed
  return () => {};
}

function getSnapshot(): boolean {
  return navigator.userAgent.includes("Mac");
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Detect if the user is on macOS (for keyboard shortcut display).
 * Returns false during SSR.
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
