import { create } from "zustand";

export interface NavigationIntent {
  action: "navigate";
  url: string;
  prefillData?: Record<string, unknown>;
  openDialog?: string;
  description: string;
}

interface PrefillStore {
  prefillData: Record<string, unknown> | null;
  openDialog: string | null;
  setPrefill: (data: Record<string, unknown>, dialog?: string | null) => void;
  consume: () => {
    prefillData: Record<string, unknown> | null;
    openDialog: string | null;
  };
}

export const usePrefillStore = create<PrefillStore>((set, get) => ({
  prefillData: null,
  openDialog: null,

  setPrefill: (data, dialog) =>
    set({ prefillData: data, openDialog: dialog ?? null }),

  consume: () => {
    const { prefillData, openDialog } = get();
    set({ prefillData: null, openDialog: null });
    return { prefillData, openDialog };
  },
}));
