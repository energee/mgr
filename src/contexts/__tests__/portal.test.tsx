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
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react, per src/components/domain/recipe/__tests__/mash-schedule-editor.test.tsx).
 * PortalProvider is used via JSX rather than React.createElement: its props
 * type declares `children: ReactNode` as required, and TypeScript's
 * createElement overloads (unlike the JSX transform) don't merge a variadic
 * children argument into that required prop.
 * A tiny inline ErrorBoundary is used to observe the render-time throw from
 * the outside-provider case, since React (createRoot) unmounts the tree and
 * surfaces the error to the nearest boundary rather than to the caller.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { Component, act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  PortalProvider,
  usePortalCustomer,
  type PortalCustomer,
} from "../portal";

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(el: ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** Renders the hook's return value as text so assertions can read the DOM. */
function Probe() {
  const ctx = usePortalCustomer();
  return (
    <div data-testid="probe">
      {JSON.stringify({ customers: ctx.customers, customerIds: ctx.customerIds })}
    </div>
  );
}

/** Stashes the raw (non-serialized) hook return value for identity checks. */
let captured: unknown = undefined;
function CapturingProbe() {
  captured = usePortalCustomer();
  return null;
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return <div data-testid="boundary-error">{this.state.error.message}</div>;
    }
    return this.props.children;
  }
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
    const c = render(
      <PortalProvider value={{ customers, customerIds: ["c1", "c2"] }}>
        <Probe />
      </PortalProvider>
    );
    const text = c.querySelector('[data-testid="probe"]')?.textContent ?? "";
    expect(JSON.parse(text)).toEqual({
      customers,
      customerIds: ["c1", "c2"],
    });
  });

  it("re-renders consumers when the provider is given a new value object", () => {
    const valueA = { customers: [{ id: "c1", name: "A" }], customerIds: ["c1"] };
    const valueB = { customers: [{ id: "c2", name: "B" }], customerIds: ["c2"] };

    render(
      <PortalProvider value={valueA}>
        <Probe />
      </PortalProvider>
    );
    expect(container!.querySelector('[data-testid="probe"]')?.textContent).toContain("c1");

    act(() => {
      root!.render(
        <PortalProvider value={valueB}>
          <Probe />
        </PortalProvider>
      );
    });
    expect(container!.querySelector('[data-testid="probe"]')?.textContent).toContain("c2");
  });
});

describe("usePortalCustomer outside PortalProvider", () => {
  it("throws 'usePortalCustomer must be used within PortalProvider' (quirk: guard is `if (!ctx)`, not an identity check against the createContext default)", () => {
    // React logs the caught render error to console.error even inside an
    // error boundary; silence it so the expected-failure path stays quiet.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const c = render(
      <ErrorBoundary>
        <Probe />
      </ErrorBoundary>
    );

    expect(c.querySelector('[data-testid="boundary-error"]')?.textContent).toBe(
      "usePortalCustomer must be used within PortalProvider"
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
