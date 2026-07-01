/**
 * Prefill handoff: one page stashes form-prefill data (and optionally a dialog
 * to open); a later page drains it on mount. Backed by `sessionStorage` so the
 * payload survives a hard navigation. Same public API as the zustand store it
 * replaced: `usePrefillStore.getState().setPrefill(...)` / `.consume()` and the
 * selector form `usePrefillStore((s) => s.setPrefill)`.
 */

export type NavigationIntent = {
  action: "navigate";
  url: string;
  prefillData?: Record<string, unknown>;
  openDialog?: string;
  description: string;
};

type Snapshot = {
  prefillData: Record<string, unknown> | null;
  openDialog: string | null;
};

type PrefillState = Snapshot & {
  setPrefill: (data: Record<string, unknown>, dialog?: string | null) => void;
  consume: () => Snapshot;
};

const STORAGE_KEY = "mgr-prefill";
const EMPTY: Snapshot = { prefillData: null, openDialog: null };

function read(): Snapshot {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Snapshot;
  } catch {
    // sessionStorage unavailable (SSR / private browsing) or corrupt JSON
  }
  return EMPTY;
}

function write(next: Snapshot): void {
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

const state: PrefillState = {
  get prefillData() { return read().prefillData; },
  get openDialog() { return read().openDialog; },
  setPrefill: (data, dialog) => write({ prefillData: data, openDialog: dialog ?? null }),
  consume: () => {
    const snapshot = read();
    write(EMPTY);
    return snapshot;
  },
};

/**
 * Access the prefill store: pass a selector to pick a slice (hook form), or use
 * `.getState()` for the full state — mirroring the zustand API the call sites
 * were written against.
 */
export function usePrefillStore<T = PrefillState>(
  selector: (s: PrefillState) => T = (s) => s as unknown as T,
): T {
  return selector(state);
}
usePrefillStore.getState = (): PrefillState => state;
