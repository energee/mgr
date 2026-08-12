/**
 * Prefill handoff: one page stashes form-prefill data (and optionally a dialog
 * to open) via `setPrefill`; a later page drains it on mount via
 * `consumePrefill`. Backed by `sessionStorage` so the payload survives a hard
 * navigation. Client components must read it inside an effect (see
 * `usePrefillHydration`) to avoid hydration mismatches.
 */

export type NavigationIntent = {
  action: "navigate";
  url: string;
  prefillData?: Record<string, unknown>;
  openDialog?: string;
  description: string;
};

type PrefillSnapshot = {
  prefillData: Record<string, unknown> | null;
  openDialog: string | null;
};

const STORAGE_KEY = "mgr-prefill";
const EMPTY: PrefillSnapshot = { prefillData: null, openDialog: null };

function read(): PrefillSnapshot {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PrefillSnapshot;
  } catch {
    // sessionStorage unavailable (SSR / private browsing) or corrupt JSON
  }
  return EMPTY;
}

function write(next: PrefillSnapshot): void {
  try {
    if (next.prefillData || next.openDialog) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage unavailable
  }
}

/** Stash prefill data (and optionally a dialog to open) for the next page. */
export function setPrefill(
  data: Record<string, unknown>,
  dialog?: string | null,
): void {
  write({ prefillData: data, openDialog: dialog ?? null });
}

/** Drain the pending prefill payload, clearing it so it is consumed once. */
export function consumePrefill(): PrefillSnapshot {
  const snapshot = read();
  write(EMPTY);
  return snapshot;
}
