// @vitest-environment jsdom
/**
 * Characterization tests for the Portal context (src/contexts/portal.tsx).
 *
 * A tiny, dependency-free React context: PortalProvider takes an explicit
 * `value` prop (no internal state/fetching) and usePortalCustomer() reads it
 * back via useContext, throwing if there is no ancestor provider. This pins:
 *   - children render through the provider unchanged
 *   - the hook returns the *exact* value object passed to the provider
 *     (reference identity — no cloning/derivation happens)
 *   - the hook throws a specific error message when used outside the
 *     provider (the context default is `null`, and the hook guards with
 *     `if (!ctx) throw ...`)
 *
 * Follows the repo's render-test idiom via the shared createRoot + act
 * harness (see src/test/react-harness.ts; no @testing-library/react).
 * PortalProvider is used via JSX rather than React.createElement: its props
 * type declares `children: ReactNode` as required, and TypeScript's
 * createElement overloads (unlike the JSX transform) don't merge a variadic
 * children argument into that required prop.
 * The outside-provider case follows the sibling idiom in
 * permissions.test.tsx: React (createRoot) re-throws a synchronous
 * render-time error out of act() when there is no error boundary in the
 * tree, so the throw is observed directly via
 * `expect(() => render(...)).toThrow(...)` rather than via an error
 * boundary. React still logs the caught error to console.error, so that is
 * spied on to keep the expected-failure path quiet.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { useEffect } from "react";

import { setupRenderHarness } from "@/test/react-harness";
import {
  PortalProvider,
  usePortalCustomer,
  type PortalCustomer,
} from "../portal";

const { render, rerender, unmount } = setupRenderHarness();

afterEach(() => {
  // Unmount before restoring spies (same-level afterEach runs LIFO; the
  // harness cleanup registered above would otherwise run after this hook).
  unmount();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** Stashes the raw (non-serialized) hook return value for identity checks. */
let captured: unknown = undefined;

beforeEach(() => {
  captured = undefined;
});

function CapturingProbe() {
  const ctx = usePortalCustomer();
  // Capture in an effect, not during render (render-phase reassignment of an
  // outer variable is flagged by the React Compiler lint rule). act() flushes
  // effects, so `captured` is set by the time the test reads it.
  useEffect(() => {
    captured = ctx;
  });
  return null;
}

/** Calls the hook and renders nothing — used to observe the outside-provider throw. */
function HookProbe() {
  usePortalCustomer();
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PortalProvider", () => {
  it("renders its children", () => {
    const value = { customers: [], customerIds: [] };
    const c = render(
      <PortalProvider value={value}>
        <span data-testid="child">hello</span>
      </PortalProvider>
    );
    expect(c.querySelector('[data-testid="child"]')?.textContent).toBe("hello");
  });

  it("supplies the exact `value` object reference to consumers (no cloning)", () => {
    const value = {
      customers: [{ id: "c1", name: "Acme" }] as PortalCustomer[],
      customerIds: ["c1"],
    };
    render(
      <PortalProvider value={value}>
        <CapturingProbe />
      </PortalProvider>
    );
    expect(captured).toBe(value);
  });

  it("lets usePortalCustomer read customers/customerIds through the provider", () => {
    const customers: PortalCustomer[] = [
      { id: "c1", name: "Acme Brewing" },
      { id: "c2", name: "Big Barrel Co" },
    ];
    render(
      <PortalProvider value={{ customers, customerIds: ["c1", "c2"] }}>
        <CapturingProbe />
      </PortalProvider>
    );
    expect(captured).toEqual({ customers, customerIds: ["c1", "c2"] });
  });

  it("re-renders consumers when the provider is given a new value object", () => {
    const valueA = { customers: [{ id: "c1", name: "A" }], customerIds: ["c1"] };
    const valueB = { customers: [{ id: "c2", name: "B" }], customerIds: ["c2"] };

    render(
      <PortalProvider value={valueA}>
        <CapturingProbe />
      </PortalProvider>
    );
    expect(captured).toEqual(valueA);

    rerender(
      <PortalProvider value={valueB}>
        <CapturingProbe />
      </PortalProvider>
    );
    expect(captured).toEqual(valueB);
  });
});

describe("usePortalCustomer outside PortalProvider", () => {
  it("throws 'usePortalCustomer must be used within PortalProvider' (quirk: guard is `if (!ctx)`, not an identity check against the createContext default)", () => {
    // React logs the caught render error to console.error even though the
    // throw propagates out of act() with no boundary to swallow it; silence
    // it so the expected-failure path stays quiet.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(<HookProbe />);
    }).toThrow("usePortalCustomer must be used within PortalProvider");

    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
