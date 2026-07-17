/**
 * Comprehensive tests for the permission system.
 *
 * Covers: hasPermission, getPermissions, getRolesForPermission,
 * isPortalUser, shouldAssignCustomerRole, PERMISSION_MAP structure,
 * STAFF_ROLES, and ALL_ROLES constants.
 */
import { describe, it, expect } from "vitest";
import {
  hasPermission,
  getPermissions,
  getRolesForPermission,
  isPortalUser,
  shouldAssignCustomerRole,
  PERMISSION_MAP,
  STAFF_ROLES,
  ALL_ROLES,
  type Permission,
  type StaffRole,
  type UserRole,
} from "@/lib/permissions";

// Collect all permissions from the map for iteration
const ALL_PERMISSIONS = Object.keys(PERMISSION_MAP) as Permission[];

// =============================================================================
// hasPermission
// =============================================================================

describe("hasPermission", () => {
  it("admin has all permissions", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(
        hasPermission(["admin"], permission),
        `admin should have ${permission}`
      ).toBe(true);
    }
  });

  it("brewer can read recipes", () => {
    expect(hasPermission(["brewer"], "recipes:read")).toBe(true);
  });

  it("brewer can write recipes", () => {
    expect(hasPermission(["brewer"], "recipes:write")).toBe(true);
  });

  it("brewer can read batches", () => {
    expect(hasPermission(["brewer"], "batches:read")).toBe(true);
  });

  it("brewer can write batches", () => {
    expect(hasPermission(["brewer"], "batches:write")).toBe(true);
  });

  it("brewer can read and write vessels", () => {
    expect(hasPermission(["brewer"], "vessels:read")).toBe(true);
    expect(hasPermission(["brewer"], "vessels:write")).toBe(true);
  });

  it("brewer cannot manage users", () => {
    expect(hasPermission(["brewer"], "users:manage")).toBe(false);
  });

  it("brewer cannot manage settings", () => {
    expect(hasPermission(["brewer"], "settings:manage")).toBe(false);
  });

  it("brewer cannot manage integrations", () => {
    expect(hasPermission(["brewer"], "integrations:manage")).toBe(false);
  });

  it("brewer cannot write orders", () => {
    expect(hasPermission(["brewer"], "orders:write")).toBe(false);
  });

  it("brewer cannot write inventory", () => {
    expect(hasPermission(["brewer"], "inventory:write")).toBe(false);
  });

  it("sales can read orders", () => {
    expect(hasPermission(["sales"], "orders:read")).toBe(true);
  });

  it("sales can write orders", () => {
    expect(hasPermission(["sales"], "orders:write")).toBe(true);
  });

  it("sales can read customers", () => {
    expect(hasPermission(["sales"], "customers:read")).toBe(true);
  });

  it("sales can write customers", () => {
    expect(hasPermission(["sales"], "customers:write")).toBe(true);
  });

  it("sales cannot write batches", () => {
    expect(hasPermission(["sales"], "batches:write")).toBe(false);
  });

  it("sales cannot write recipes", () => {
    expect(hasPermission(["sales"], "recipes:write")).toBe(false);
  });

  it("sales cannot manage users", () => {
    expect(hasPermission(["sales"], "users:manage")).toBe(false);
  });

  it("viewer has all read permissions", () => {
    const readPermissions = ALL_PERMISSIONS.filter((p) => p.endsWith(":read"));
    for (const permission of readPermissions) {
      expect(
        hasPermission(["viewer"], permission),
        `viewer should have ${permission}`
      ).toBe(true);
    }
  });

  it("viewer has no write permissions", () => {
    const writePermissions = ALL_PERMISSIONS.filter((p) => p.endsWith(":write"));
    for (const permission of writePermissions) {
      expect(
        hasPermission(["viewer"], permission),
        `viewer should NOT have ${permission}`
      ).toBe(false);
    }
  });

  it("viewer has no manage permissions", () => {
    const managePermissions = ALL_PERMISSIONS.filter((p) =>
      p.endsWith(":manage")
    );
    for (const permission of managePermissions) {
      expect(
        hasPermission(["viewer"], permission),
        `viewer should NOT have ${permission}`
      ).toBe(false);
    }
  });

  it("production_manager can read and write vessels", () => {
    expect(hasPermission(["production_manager"], "vessels:read")).toBe(true);
    expect(hasPermission(["production_manager"], "vessels:write")).toBe(true);
  });

  it("production_manager can read and write batches", () => {
    expect(hasPermission(["production_manager"], "batches:read")).toBe(true);
    expect(hasPermission(["production_manager"], "batches:write")).toBe(true);
  });

  it("production_manager can read and write inventory", () => {
    expect(hasPermission(["production_manager"], "inventory:read")).toBe(true);
    expect(hasPermission(["production_manager"], "inventory:write")).toBe(true);
  });

  it("production_manager can read and write purchasing", () => {
    expect(hasPermission(["production_manager"], "purchasing:read")).toBe(true);
    expect(hasPermission(["production_manager"], "purchasing:write")).toBe(true);
  });

  it("production_manager cannot manage users", () => {
    expect(hasPermission(["production_manager"], "users:manage")).toBe(false);
  });

  it("production_manager cannot write recipes", () => {
    expect(hasPermission(["production_manager"], "recipes:write")).toBe(false);
  });

  it("multiple roles combine permissions — brewer + sales", () => {
    const combined: UserRole[] = ["brewer", "sales"];
    // brewer perms
    expect(hasPermission(combined, "recipes:write")).toBe(true);
    expect(hasPermission(combined, "batches:write")).toBe(true);
    // sales perms
    expect(hasPermission(combined, "orders:write")).toBe(true);
    expect(hasPermission(combined, "customers:write")).toBe(true);
    // neither has
    expect(hasPermission(combined, "users:manage")).toBe(false);
    expect(hasPermission(combined, "settings:manage")).toBe(false);
  });

  it("multiple roles combine — viewer + production_manager", () => {
    const combined: UserRole[] = ["viewer", "production_manager"];
    // production_manager write perms
    expect(hasPermission(combined, "inventory:write")).toBe(true);
    expect(hasPermission(combined, "vessels:write")).toBe(true);
    // viewer read perms (also covered by production_manager)
    expect(hasPermission(combined, "recipes:read")).toBe(true);
    // neither has
    expect(hasPermission(combined, "integrations:manage")).toBe(false);
  });

  it("empty roles array has no permissions", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(
        hasPermission([], permission),
        `empty roles should NOT have ${permission}`
      ).toBe(false);
    }
  });

  it("customer role has no staff permissions", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(
        hasPermission(["customer"], permission),
        `customer should NOT have ${permission}`
      ).toBe(false);
    }
  });

  it("grants brewery-funded AI chat to staff but not portal customers", () => {
    for (const role of STAFF_ROLES) {
      expect(hasPermission([role], "ai:use"), `${role} should have ai:use`).toBe(true);
    }
    expect(hasPermission(["customer"], "ai:use")).toBe(false);
  });

  it("customer combined with a staff role gains that role's permissions", () => {
    expect(hasPermission(["customer", "viewer"], "recipes:read")).toBe(true);
    expect(hasPermission(["customer", "viewer"], "recipes:write")).toBe(false);
  });
});

// =============================================================================
// getPermissions
// =============================================================================

describe("getPermissions", () => {
  it("returns all permissions for admin", () => {
    const perms = getPermissions(["admin"]);
    expect(perms).toEqual(expect.arrayContaining(ALL_PERMISSIONS));
    expect(perms).toHaveLength(ALL_PERMISSIONS.length);
  });

  it("returns deduplicated permissions for overlapping roles", () => {
    // admin already has everything, so admin + brewer should still be all permissions
    const perms = getPermissions(["admin", "brewer"]);
    const uniquePerms = [...new Set(perms)];
    expect(perms).toHaveLength(uniquePerms.length);
    expect(perms).toHaveLength(ALL_PERMISSIONS.length);
  });

  it("returns deduplicated permissions for brewer + sales", () => {
    const perms = getPermissions(["brewer", "sales"]);
    const uniquePerms = [...new Set(perms)];
    expect(perms).toHaveLength(uniquePerms.length);
    // Should include all read perms they share plus their respective write perms
    expect(perms).toContain("recipes:read");
    expect(perms).toContain("recipes:write");
    expect(perms).toContain("orders:write");
    expect(perms).toContain("customers:write");
  });

  it("returns empty for empty roles", () => {
    expect(getPermissions([])).toEqual([]);
  });

  it("returns empty for customer-only role", () => {
    expect(getPermissions(["customer"])).toEqual([]);
  });

  it("returns correct permissions for viewer", () => {
    const perms = getPermissions(["viewer"]);
    // All read permissions
    for (const perm of ALL_PERMISSIONS.filter((p) => p.endsWith(":read"))) {
      expect(perms).toContain(perm);
    }
    // No write or manage permissions
    for (const perm of ALL_PERMISSIONS.filter(
      (p) => p.endsWith(":write") || p.endsWith(":manage")
    )) {
      expect(perms).not.toContain(perm);
    }
  });

  it("returns correct permissions for brewer", () => {
    const perms = getPermissions(["brewer"]);
    expect(perms).toContain("recipes:read");
    expect(perms).toContain("recipes:write");
    expect(perms).toContain("batches:read");
    expect(perms).toContain("batches:write");
    expect(perms).toContain("vessels:read");
    expect(perms).toContain("vessels:write");
    expect(perms).toContain("inventory:read");
    expect(perms).not.toContain("orders:write");
    expect(perms).not.toContain("users:manage");
  });

  it("returns permissions in PERMISSION_MAP key order", () => {
    const perms = getPermissions(["admin"]);
    // getPermissions uses Object.keys(PERMISSION_MAP).filter(...)
    // so the order should match PERMISSION_MAP key order
    expect(perms).toEqual(ALL_PERMISSIONS);
  });
});

// =============================================================================
// getRolesForPermission
// =============================================================================

describe("getRolesForPermission", () => {
  it("returns every staff role for ai:use", () => {
    expect(getRolesForPermission("ai:use")).toEqual([...STAFF_ROLES]);
  });

  it("returns all roles that have recipes:read", () => {
    const roles = getRolesForPermission("recipes:read");
    expect(roles).toEqual(
      expect.arrayContaining([
        "admin",
        "production_manager",
        "brewer",
        "sales",
        "viewer",
      ])
    );
    expect(roles).toHaveLength(5);
  });

  it("returns only admin for users:manage", () => {
    const roles = getRolesForPermission("users:manage");
    expect(roles).toEqual(["admin"]);
  });

  it("returns only admin for settings:manage", () => {
    const roles = getRolesForPermission("settings:manage");
    expect(roles).toEqual(["admin"]);
  });

  it("returns only admin for integrations:manage", () => {
    const roles = getRolesForPermission("integrations:manage");
    expect(roles).toEqual(["admin"]);
  });

  it("returns correct roles for recipes:write", () => {
    const roles = getRolesForPermission("recipes:write");
    expect(roles).toEqual(expect.arrayContaining(["admin", "brewer"]));
    expect(roles).toHaveLength(2);
  });

  it("returns correct roles for orders:write", () => {
    const roles = getRolesForPermission("orders:write");
    expect(roles).toEqual(expect.arrayContaining(["admin", "sales"]));
    expect(roles).toHaveLength(2);
  });

  it("returns correct roles for batches:write", () => {
    const roles = getRolesForPermission("batches:write");
    expect(roles).toEqual(
      expect.arrayContaining(["admin", "production_manager", "brewer"])
    );
    expect(roles).toHaveLength(3);
  });

  it("returns correct roles for inventory:write", () => {
    const roles = getRolesForPermission("inventory:write");
    expect(roles).toEqual(
      expect.arrayContaining(["admin", "production_manager"])
    );
    expect(roles).toHaveLength(2);
  });

  it("returns correct roles for vessels:write", () => {
    const roles = getRolesForPermission("vessels:write");
    expect(roles).toEqual(
      expect.arrayContaining(["admin", "production_manager", "brewer"])
    );
    expect(roles).toHaveLength(3);
  });

  it("returns a copy, not a reference to the original array", () => {
    const roles1 = getRolesForPermission("recipes:read");
    const roles2 = getRolesForPermission("recipes:read");
    expect(roles1).toEqual(roles2);
    expect(roles1).not.toBe(roles2);
    // Mutating the returned array should not affect subsequent calls
    roles1.push("admin" as StaffRole);
    const roles3 = getRolesForPermission("recipes:read");
    expect(roles3).toHaveLength(5);
  });
});

// =============================================================================
// PERMISSION_MAP structure
// =============================================================================

describe("PERMISSION_MAP", () => {
  it("all permissions reference valid staff roles", () => {
    for (const [permission, roles] of Object.entries(PERMISSION_MAP)) {
      for (const role of roles) {
        expect(
          (STAFF_ROLES as readonly string[]).includes(role),
          `${permission} references invalid role "${role}"`
        ).toBe(true);
      }
    }
  });

  it("every permission has at least one role", () => {
    for (const [permission, roles] of Object.entries(PERMISSION_MAP)) {
      expect(
        roles.length,
        `${permission} should have at least one role`
      ).toBeGreaterThan(0);
    }
  });

  it("admin appears in every permission", () => {
    for (const [permission, roles] of Object.entries(PERMISSION_MAP)) {
      expect(
        roles.includes("admin"),
        `admin should appear in ${permission}`
      ).toBe(true);
    }
  });

  it("no duplicate roles within a single permission", () => {
    for (const [permission, roles] of Object.entries(PERMISSION_MAP)) {
      const uniqueRoles = [...new Set(roles)];
      expect(
        roles.length,
        `${permission} has duplicate roles`
      ).toBe(uniqueRoles.length);
    }
  });

  it("contains expected number of permissions", () => {
    // 7 resources x 2 (read/write) + 3 manage + AI use = 18
    expect(ALL_PERMISSIONS).toHaveLength(18);
  });

  it("covers all expected resource areas", () => {
    const resources = new Set(ALL_PERMISSIONS.map((p) => p.split(":")[0]));
    expect(resources).toEqual(
      new Set([
        "recipes",
        "batches",
        "orders",
        "customers",
        "inventory",
        "purchasing",
        "vessels",
        "integrations",
        "settings",
        "users",
        "ai",
      ])
    );
  });
});

// =============================================================================
// STAFF_ROLES and ALL_ROLES consistency
// =============================================================================

describe("STAFF_ROLES and ALL_ROLES", () => {
  it("STAFF_ROLES contains expected roles", () => {
    expect([...STAFF_ROLES]).toEqual([
      "admin",
      "production_manager",
      "brewer",
      "sales",
      "viewer",
    ]);
  });

  it("ALL_ROLES includes all staff roles plus customer", () => {
    for (const role of STAFF_ROLES) {
      expect(
        (ALL_ROLES as readonly string[]).includes(role),
        `ALL_ROLES should include staff role "${role}"`
      ).toBe(true);
    }
    expect((ALL_ROLES as readonly string[]).includes("customer")).toBe(true);
  });

  it("ALL_ROLES has exactly one more entry than STAFF_ROLES", () => {
    expect(ALL_ROLES.length).toBe(STAFF_ROLES.length + 1);
  });

  it("customer is not in STAFF_ROLES", () => {
    expect(
      (STAFF_ROLES as readonly string[]).includes("customer")
    ).toBe(false);
  });
});

// =============================================================================
// isPortalUser — app-shell portal redirect predicate (audit C1)
// =============================================================================

describe("isPortalUser", () => {
  it("true for exactly ['customer']", () => {
    expect(isPortalUser(["customer"])).toBe(true);
  });

  it("true whenever customer appears in a mixed role set (fail-closed)", () => {
    expect(isPortalUser(["customer", "viewer"])).toBe(true);
    expect(isPortalUser(["admin", "customer"])).toBe(true);
    expect(isPortalUser(["viewer", "customer", "sales"])).toBe(true);
  });

  it("false for every pure staff role set", () => {
    for (const role of STAFF_ROLES) {
      expect(isPortalUser([role]), `${role} alone is staff`).toBe(false);
    }
    expect(isPortalUser([...STAFF_ROLES])).toBe(false);
  });

  it("false for an empty role set", () => {
    expect(isPortalUser([])).toBe(false);
  });
});

// =============================================================================
// shouldAssignCustomerRole — portal-invite role-set decision (audit C1)
// =============================================================================

describe("shouldAssignCustomerRole", () => {
  it("true for a missing profile (null/undefined)", () => {
    expect(shouldAssignCustomerRole(null)).toBe(true);
    expect(shouldAssignCustomerRole(undefined)).toBe(true);
  });

  it("true for an empty role set", () => {
    expect(shouldAssignCustomerRole([])).toBe(true);
  });

  it("true for the untouched signup default ['viewer']", () => {
    expect(shouldAssignCustomerRole(["viewer"])).toBe(true);
  });

  it("false for every non-viewer staff role (never clobbers staff)", () => {
    for (const role of STAFF_ROLES.filter((r) => r !== "viewer")) {
      expect(shouldAssignCustomerRole([role]), `${role} must be preserved`).toBe(false);
    }
  });

  it("false for multi-role sets, even ones containing viewer", () => {
    expect(shouldAssignCustomerRole(["viewer", "brewer"])).toBe(false);
    expect(shouldAssignCustomerRole(["admin", "viewer"])).toBe(false);
  });

  it("false when already ['customer'] (idempotent no-op path)", () => {
    expect(shouldAssignCustomerRole(["customer"])).toBe(false);
  });
});
