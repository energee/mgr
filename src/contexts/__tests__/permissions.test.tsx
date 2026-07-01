// @vitest-environment jsdom
/**
 * Characterization tests for PermissionProvider / usePermissions.
 *
 * The module is pure React context glue over `@/lib/permissions`
 * (getPermissions/hasPermission) — those pure functions are already covered
 * by lib/permissions tests, so this file targets only the provider/hook
 * wiring: what value the provider computes for a given `roles` prop, the
 * shape/identity behavior of the memoized value, and what usePermissions()
 * does when called outside a provider.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react — see mash-schedule-editor.test.tsx).
 */

import { describe, it, expect, afterEach } from "vitest";
import { act, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PermissionProvider, usePermissions } from "../permissions";
import type { UserRole, Permission } from "@/lib/permissions";

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(el: ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
  return container;
}

function rerender(el: ReactElement) {
  act(() => root!.render(el));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

// Captures the live context value object so tests can assert on its shape,
// derived data, and referential identity across re-renders. A module-level
// variable (not a prop) is used so the effect write doesn't trip the React
// Compiler immutability lint rule; act() flushes the effect, so `captured` is
// populated by the time each test reads it.
let captured: ReturnType<typeof usePermissions> | null = null;

function Probe() {
  const ctx = usePermissions();
  useEffect(() => {
    captured = ctx;
  });
  return (
    <div>
      <span data-testid="roles">{ctx.roles.join(",")}</span>
      <span data-testid="permissions">{ctx.permissions.join(",")}</span>
    </div>
  );
}

describe("PermissionProvider", () => {
  it("provides roles as-is and a permissions list derived via getPermissions", () => {
    const roles: UserRole[] = ["admin"];
    render(
      <PermissionProvider roles={roles}>
        <Probe />
      </PermissionProvider>
    );

    expect(captured?.roles).toEqual(["admin"]);
    // admin grants every permission in PERMISSION_MAP
    expect(captured?.permissions).toEqual(
      expect.arrayContaining<Permission>(["recipes:read", "recipes:write", "settings:manage", "users:manage"])
    );
    expect(captured?.permissions.length).toBeGreaterThan(0);
  });

  it("restricts permissions for a read-only role (viewer)", () => {
    render(
      <PermissionProvider roles={["viewer"]}>
        <Probe />
      </PermissionProvider>
    );

    expect(captured?.can("recipes:read")).toBe(true);
    expect(captured?.can("batches:read")).toBe(true);
    expect(captured?.can("recipes:write")).toBe(false);
    expect(captured?.can("settings:manage")).toBe(false);
    expect(captured?.can("integrations:manage")).toBe(false);
  });

  it("unions permissions across multiple roles", () => {
    // brewer alone doesn't grant orders:write; sales alone doesn't grant
    // recipes:write. Combined, both should be available.
    render(
      <PermissionProvider roles={["brewer", "sales"]}>
        <Probe />
      </PermissionProvider>
    );

    expect(captured?.can("recipes:write")).toBe(true);
    expect(captured?.can("orders:write")).toBe(true);
    expect(captured?.can("settings:manage")).toBe(false);
  });

  it("grants no permissions for the customer role (excluded from PERMISSION_MAP)", () => {
    render(
      <PermissionProvider roles={["customer"]}>
        <Probe />
      </PermissionProvider>
    );

    expect(captured?.permissions).toEqual([]);
    expect(captured?.can("recipes:read")).toBe(false);
    // hasRole is a plain roles.includes() check, independent of PERMISSION_MAP,
    // so the customer role itself still reads back as true.
    expect(captured?.hasRole("customer")).toBe(true);
  });

  it("grants no permissions and no roles for an empty roles array", () => {
    render(
      <PermissionProvider roles={[]}>
        <Probe />
      </PermissionProvider>
    );

    expect(captured?.roles).toEqual([]);
    expect(captured?.permissions).toEqual([]);
    expect(captured?.hasRole("admin")).toBe(false);
    expect(captured?.can("recipes:read")).toBe(false);
  });

  it("hasRole checks membership in the roles prop, not derived permissions", () => {
    render(
      <PermissionProvider roles={["brewer"]}>
        <Probe />
      </PermissionProvider>
    );

    expect(captured?.hasRole("brewer")).toBe(true);
    expect(captured?.hasRole("admin")).toBe(false);
    expect(captured?.hasRole("viewer")).toBe(false);
  });

  it("memoizes the context value by roles identity: same array reference across re-renders keeps the same value object", () => {
    const roles: UserRole[] = ["admin"];
    render(
      <PermissionProvider roles={roles}>
        <Probe />
      </PermissionProvider>
    );
    const firstValue = captured;

    // Re-render with an unrelated prop change but the exact same roles
    // array reference — useMemo's dependency array is [roles], so the
    // context value object identity should be preserved.
    rerender(
      <PermissionProvider roles={roles}>
        <Probe />
      </PermissionProvider>
    );

    expect(captured).toBe(firstValue);
  });

  it("quirk: a new array with identical contents still recomputes the value (useMemo compares by reference, not deep equality)", () => {
    render(
      <PermissionProvider roles={["admin"]}>
        <Probe />
      </PermissionProvider>
    );
    const firstValue = captured;

    // New array literal, same contents — useMemo sees a changed dependency
    // (Object.is on the array reference) and recomputes, even though the
    // resulting `permissions`/`can`/`hasRole` behave identically.
    rerender(
      <PermissionProvider roles={["admin"]}>
        <Probe />
      </PermissionProvider>
    );

    expect(captured).not.toBe(firstValue);
    expect(captured?.roles).toEqual(firstValue?.roles);
    expect(captured?.permissions).toEqual(firstValue?.permissions);
  });

  it("can() reflects a Set built once per memoized value — checking permissions works for every key in PERMISSION_MAP", () => {
    render(
      <PermissionProvider roles={["admin"]}>
        <Probe />
      </PermissionProvider>
    );

    for (const permission of captured!.permissions) {
      expect(captured!.can(permission)).toBe(true);
    }
  });
});

describe("usePermissions outside a PermissionProvider", () => {
  it("throws a descriptive error instead of returning a default value", () => {
    function BareProbe() {
      usePermissions();
      return null;
    }

    // React re-throws synchronously-thrown render errors out of act() when
    // there is no error boundary in the tree.
    expect(() => {
      render(<BareProbe />);
    }).toThrow("usePermissions must be used within PermissionProvider");
  });
});
