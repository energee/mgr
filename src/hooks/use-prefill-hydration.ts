"use client";

/**
 * usePrefillHydration
 *
 * Safely reads the AI prefill store after hydration. The store is backed by
 * sessionStorage (client-only), so reading it during render causes a React
 * hydration mismatch (server gets null, client gets stored data). Deferring
 * to useEffect ensures SSR and client render agree on the initial state before
 * the prefill is applied. Callers gate their form on `ready` (render null
 * until true) so react-hook-form's `defaultValues` are known at mount —
 * react-hook-form does not re-initialize from prop changes.
 *
 * The functional setState guards against React Strict Mode's double-invocation:
 * the second effect call finds the store already empty (consume() drains it),
 * but the functional updater sees `prev.ready === true` and preserves the data
 * from the first call.
 *
 * Pass `{ enabled: false }` to skip consuming entirely — `ready` is then true
 * from the first render and the store is left untouched. EntityDetailUnified
 * uses this to consume only in create mode, leaving detail/edit mode
 * completely unaffected.
 */

import { useEffect, useState } from "react";
import { usePrefillStore } from "@/contexts/prefill-store";

type PrefillHydrationState = {
  ready: boolean;
  defaultValues: Record<string, unknown> | undefined;
};

export function usePrefillHydration({
  enabled = true,
}: { enabled?: boolean } = {}): PrefillHydrationState {
  const [state, setState] = useState<PrefillHydrationState>(() => ({
    ready: !enabled,
    defaultValues: undefined,
  }));

  useEffect(() => {
    if (!enabled) return;
    const { prefillData } = usePrefillStore.getState().consume();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only read from sessionStorage-backed store; functional updater prevents overwrite on Strict Mode's second invocation
    setState((prev) =>
      prev.ready ? prev : { ready: true, defaultValues: prefillData ?? undefined },
    );
  }, [enabled]);

  return state;
}
