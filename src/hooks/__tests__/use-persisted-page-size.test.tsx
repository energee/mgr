/**
 * Tests for usePersistedPageSize hydration safety (SENTRY-7477285482 / MGR-7
 * pattern scan — same defect class as src/contexts/__tests__/prefill-store-hydration.test.tsx,
 * found in a different component while investigating that issue's recurrence).
 *
 * Root cause: getStoredPageSize() reads localStorage, which is unavailable
 * during SSR. The original implementation called it inside a `useState(() =>
 * ...)` lazy initializer, so the server render used the default while the
 * client's first (pre-hydration) render used the stored value whenever a
 * user had previously changed their page size — a hydration mismatch. The
 * fix defers the read to useEffect so both renders agree on `defaultSize`
 * first, then the effect applies the stored value.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { usePersistedPageSize } from "@/hooks/use-persisted-page-size";
import { setupRenderHarness } from "@/test/react-harness";

const STORAGE_KEY = "mgr:table-page-size";

beforeEach(() => {
  localStorage.clear();
});

const harness = setupRenderHarness();

function Probe({ log }: { log: number[] }) {
  const { pageSize } = usePersistedPageSize();
  log.push(pageSize);
  return null;
}

describe("usePersistedPageSize", () => {
  it("first render uses the default even when localStorage has a stored value (the SSR-identical frame)", () => {
    localStorage.setItem(STORAGE_KEY, "50");

    const log: number[] = [];
    harness.render(<Probe log={log} />);

    // Pre-effect: matches what the server would have rendered (no
    // localStorage access) — this is the invariant that prevents the
    // hydration mismatch.
    expect(log[0]).toBe(25);
    // Post-effect: corrected to the stored value.
    expect(log[log.length - 1]).toBe(50);
  });

  it("stays at the default when localStorage is empty", () => {
    const log: number[] = [];
    harness.render(<Probe log={log} />);

    expect(log.every((size) => size === 25)).toBe(true);
  });

  it("ignores invalid stored values and keeps the default", () => {
    localStorage.setItem(STORAGE_KEY, "not-a-number");

    const log: number[] = [];
    harness.render(<Probe log={log} />);

    expect(log.every((size) => size === 25)).toBe(true);
  });

  it("setPageSize updates state and persists to localStorage", () => {
    const setters: Array<(size: number) => void> = [];
    function Setter() {
      const { setPageSize } = usePersistedPageSize();
      setters.push(setPageSize);
      return null;
    }
    harness.render(<Setter />);

    act(() => setters[setters.length - 1](50));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("50");
  });

  it("persists per table key, independently of the global key", () => {
    localStorage.setItem(`${STORAGE_KEY}:orders`, "50");

    const log: number[] = [];
    const setters: Array<(size: number) => void> = [];
    function KeyedProbe() {
      const { pageSize, setPageSize } = usePersistedPageSize(25, "orders");
      log.push(pageSize);
      setters.push(setPageSize);
      return null;
    }
    harness.render(<KeyedProbe />);

    // Reads the orders-specific stored value, not the global key.
    expect(log[log.length - 1]).toBe(50);

    // Writing goes to the namespaced key only.
    act(() => setters[setters.length - 1](100));
    expect(localStorage.getItem(`${STORAGE_KEY}:orders`)).toBe("100");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
