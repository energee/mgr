import { create } from "zustand";

export interface NavigationIntent {
  action: "navigate";
  url: string;
  prefillData?: Record<string, unknown>;
  openDialog?: string;
  description: string;
}

const STORAGE_KEY = "mgr-prefill";

interface PrefillStore {
  prefillData: Record<string, unknown> | null;
  openDialog: string | null;
  setPrefill: (data: Record<string, unknown>, dialog?: string | null) => void;
  consume: () => {
    prefillData: Record<string, unknown> | null;
    openDialog: string | null;
  };
}

function writeToBacking(
  prefillData: Record<string, unknown> | null,
  openDialog: string | null,
) {
  try {
    if (prefillData || openDialog) {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ prefillData, openDialog }),
      );
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage unavailable (SSR, private browsing quota, etc.)
  }
}

function readFromBacking(): {
  prefillData: Record<string, unknown> | null;
  openDialog: string | null;
} {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // sessionStorage unavailable or corrupt
  }
  return { prefillData: null, openDialog: null };
}

export const usePrefillStore = create<PrefillStore>((set, get) => ({
  prefillData: null,
  openDialog: null,

  setPrefill: (data, dialog) => {
    const openDialog = dialog ?? null;
    set({ prefillData: data, openDialog });
    writeToBacking(data, openDialog);
  },

  consume: () => {
    // Try in-memory store first, fall back to sessionStorage
    let { prefillData, openDialog } = get();
    if (!prefillData && !openDialog) {
      ({ prefillData, openDialog } = readFromBacking());
    }
    // Clear both
    set({ prefillData: null, openDialog: null });
    writeToBacking(null, null);
    return { prefillData, openDialog };
  },
}));
