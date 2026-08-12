/**
 * Tests for prefill-store hydration safety (SENTRY-7477285482 / MGR-7).
 *
 * Root cause: consumePrefill() reads from sessionStorage, which is
 * unavailable during SSR. When called during render (instead of in useEffect),
 * it produces different values on the server (null) vs client (sessionStorage
 * data), causing React hydration mismatches.
 *
 * These tests verify:
 * 1. setPrefill persists data to sessionStorage and consume() restores it
 * 2. consume() returns null when sessionStorage is empty (server-side scenario)
 * 3. consume() clears the store after reading (idempotent on second call)
 * 4. the server/client divergence invariant that caused the Sentry issue
 * 5. usePrefillHydration (the fix): gates `ready` until after the effect runs,
 *    survives Strict Mode double-invocation, and — with `enabled: false`
 *    (EntityDetailUnified in detail/edit mode) — never touches the store.
 *
 * The store is a pair of plain sessionStorage-backed functions (no in-memory
 * state), so per-test resets are just sessionStorage.clear().
 */

import { describe, it, expect, beforeEach } from "vitest";
import { StrictMode } from "react";
import { setPrefill, consumePrefill } from "@/contexts/prefill-store";
import { usePrefillHydration } from "@/hooks/use-prefill-hydration";
import { setupRenderHarness } from "@/test/react-harness";

const STORAGE_KEY = "mgr-prefill";

beforeEach(() => {
  sessionStorage.clear();
});

describe("prefill-store sessionStorage persistence", () => {
  it("setPrefill writes dialog key to sessionStorage", () => {
    setPrefill({}, "pitch_yeast");

    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.openDialog).toBe("pitch_yeast");
  });

  it("consume() reads openDialog from sessionStorage (state after a navigation)", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ prefillData: null, openDialog: "pitch_yeast" }),
    );

    const { openDialog } = consumePrefill();
    expect(openDialog).toBe("pitch_yeast");
  });

  it("consume() returns null openDialog when sessionStorage is empty (SSR scenario)", () => {
    const { openDialog, prefillData } = consumePrefill();
    expect(openDialog).toBeNull();
    expect(prefillData).toBeNull();
  });

  it("consume() clears sessionStorage after reading (idempotent second call returns null)", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ prefillData: null, openDialog: "blend" }),
    );

    const first = consumePrefill();
    expect(first.openDialog).toBe("blend");

    // Second consume() should return null — store was cleared
    const second = consumePrefill();
    expect(second.openDialog).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("consume() reads prefillData from sessionStorage for form pre-fill", () => {
    const prefill = { recipe_id: "abc-123", planned_start_date: "2026-05-16" };
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ prefillData: prefill, openDialog: null }),
    );

    const { prefillData } = consumePrefill();
    expect(prefillData).toEqual(prefill);
  });
});

describe("hydration safety invariant", () => {
  it("client (sessionStorage populated) and server (empty) scenarios diverge — why render-time reads crash hydration", () => {
    // This test documents the mismatch that caused SENTRY-7477285482.
    // The FIX defers consume() to useEffect so both server and client
    // render identically (no sessionStorage read during render).

    // Client scenario: sessionStorage has data
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ prefillData: null, openDialog: "pitch_yeast" }),
    );
    const clientResult = consumePrefill();
    expect(clientResult.openDialog).toBe("pitch_yeast"); // client gets the value

    // Server scenario: sessionStorage unavailable → the store's read() catches
    // and returns the EMPTY snapshot. jsdom can't remove sessionStorage, but
    // an empty one exercises the same code path (read() → EMPTY).
    sessionStorage.removeItem(STORAGE_KEY);
    const serverResult = consumePrefill();
    expect(serverResult.openDialog).toBeNull(); // server gets null
    // → If both are read during render, server renders dialog=false,
    //   client renders dialog=true → hydration mismatch.
    // → Fix: read only in useEffect (after hydration) so both agree.
  });
});

// ---------------------------------------------------------------------------
// usePrefillHydration — the fix. Rendered under StrictMode so the double
// render + double effect invocation (the exact hazard the functional updater
// guards against) is exercised.
// ---------------------------------------------------------------------------

type HookState = ReturnType<typeof usePrefillHydration>;

const harness = setupRenderHarness();

function Probe({
  enabled,
  log,
}: {
  enabled?: boolean;
  log: HookState[];
}) {
  const state = usePrefillHydration(
    enabled === undefined ? undefined : { enabled },
  );
  log.push(state);
  return state.ready ? (
    <div data-testid="ready">{JSON.stringify(state.defaultValues ?? null)}</div>
  ) : null;
}

describe("usePrefillHydration", () => {
  it("gates ready=false on first paint, then consumes once and exposes defaultValues (Strict Mode safe)", () => {
    const prefill = { recipe_id: "abc-123" };
    setPrefill(prefill);

    const log: HookState[] = [];
    const container = harness.render(
      <StrictMode>
        <Probe log={log} />
      </StrictMode>,
    );

    // First paint (pre-effect) rendered nothing — the SSR-identical frame.
    expect(log[0]).toEqual({ ready: false, defaultValues: undefined });
    // After effects: ready with the consumed data, despite Strict Mode
    // running the effect twice (second consume() finds the store empty;
    // the functional updater preserves the first call's data).
    expect(log[log.length - 1]).toEqual({ ready: true, defaultValues: prefill });
    expect(container.querySelector("[data-testid=ready]")?.textContent).toBe(
      JSON.stringify(prefill),
    );
    // Store drained exactly once.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("returns ready=true with undefined defaultValues when the store is empty", () => {
    const log: HookState[] = [];
    harness.render(
      <StrictMode>
        <Probe log={log} />
      </StrictMode>,
    );
    expect(log[log.length - 1]).toEqual({ ready: true, defaultValues: undefined });
  });

  it("enabled:false (EntityDetailUnified detail/edit mode) is ready immediately and never consumes", () => {
    const prefill = { recipe_id: "abc-123" };
    setPrefill(prefill);

    const log: HookState[] = [];
    harness.render(
      <StrictMode>
        <Probe enabled={false} log={log} />
      </StrictMode>,
    );

    // Ready from the very first render — no gating frame, no consume.
    expect(log[0]).toEqual({ ready: true, defaultValues: undefined });
    expect(log[log.length - 1]).toEqual({ ready: true, defaultValues: undefined });
    // The pending prefill is left for the create route to drain.
    expect(consumePrefill().prefillData).toEqual(prefill);
  });
});
