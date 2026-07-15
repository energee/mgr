/**
 * Permission Map Module
 *
 * Defines roles, permissions, and the mapping between them.
 * Pure TypeScript — no external dependencies.
 *
 * Consumed by:
 * - API middleware (src/lib/api/auth.ts)
 * - React context (src/contexts/permissions.tsx)
 * - Postgres migration (mirrors this map in SQL)
 */

// =============================================================================
// Roles
// =============================================================================

/** Staff roles that can be assigned to brewery team members. */
export const STAFF_ROLES = [
  "admin",
  "production_manager",
  "brewer",
  "sales",
  "viewer",
] as const;

/** All roles including customer portal access. */
export const ALL_ROLES = [...STAFF_ROLES, "customer"] as const;

/** A role that can be assigned to a staff member. */
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Any role in the system, including customer. */
export type UserRole = (typeof ALL_ROLES)[number];

// =============================================================================
// Permissions
// =============================================================================

/**
 * Every granular permission string in the system.
 *
 * Format: `<resource>:<action>`
 */
export type Permission =
  | "recipes:read"
  | "recipes:write"
  | "batches:read"
  | "batches:write"
  | "orders:read"
  | "orders:write"
  | "customers:read"
  | "customers:write"
  | "inventory:read"
  | "inventory:write"
  | "purchasing:read"
  | "purchasing:write"
  | "vessels:read"
  | "vessels:write"
  | "ai:use"
  | "integrations:manage"
  | "settings:manage"
  | "users:manage";

// =============================================================================
// Permission Map
// =============================================================================

/**
 * Maps each permission to the staff roles that grant it.
 *
 * Customer role is intentionally excluded — customers access data through
 * the portal with its own RLS policies, not through staff permissions.
 */
export const PERMISSION_MAP: Record<Permission, readonly StaffRole[]> = {
  "recipes:read": ["admin", "production_manager", "brewer", "sales", "viewer"],
  "recipes:write": ["admin", "brewer"],

  "batches:read": ["admin", "production_manager", "brewer", "sales", "viewer"],
  "batches:write": ["admin", "production_manager", "brewer"],

  "orders:read": ["admin", "production_manager", "sales", "viewer"],
  "orders:write": ["admin", "sales"],

  "customers:read": ["admin", "production_manager", "sales", "viewer"],
  "customers:write": ["admin", "sales"],

  "inventory:read": [
    "admin",
    "production_manager",
    "brewer",
    "sales",
    "viewer",
  ],
  "inventory:write": ["admin", "production_manager"],

  "purchasing:read": ["admin", "production_manager", "viewer"],
  "purchasing:write": ["admin", "production_manager"],

  "vessels:read": [
    "admin",
    "production_manager",
    "brewer",
    "sales",
    "viewer",
  ],
  "vessels:write": ["admin", "production_manager", "brewer"],

  "ai:use": ["admin", "production_manager", "brewer", "sales", "viewer"],

  "integrations:manage": ["admin"],
  "settings:manage": ["admin"],
  "users:manage": ["admin"],
} as const;

// =============================================================================
// Domain-to-Write-Permission Mapping
// =============================================================================

/**
 * Maps entity domains to the write permission required.
 * Used for cosmetic gating (hiding edit buttons when the user lacks permission).
 */
export const DOMAIN_WRITE_PERMISSIONS: Record<string, Permission> = {
  production: "batches:write",
  inventory: "inventory:write",
  sales: "orders:write",
  purchasing: "purchasing:write",
  system: "settings:manage",
  packaging: "batches:write",
  reporting: "batches:read",
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check whether any of the given roles grants a specific permission.
 *
 * Customer-only users receive no staff permissions — they access data
 * through portal-specific RLS policies instead.
 */
export function hasPermission(
  roles: UserRole[],
  permission: Permission,
): boolean {
  const allowedRoles: readonly string[] = PERMISSION_MAP[permission];
  return roles.some((role) => allowedRoles.includes(role));
}

/**
 * Return every permission granted by a set of roles.
 *
 * Useful for populating a permission context on login so that UI
 * components can check capabilities without repeated map lookups.
 */
export function getPermissions(roles: UserRole[]): Permission[] {
  return (Object.keys(PERMISSION_MAP) as Permission[]).filter((permission) =>
    hasPermission(roles, permission),
  );
}

/**
 * Return the staff roles that grant a given permission.
 *
 * Useful for building role-selection UIs or SQL policy conditions.
 */
export function getRolesForPermission(permission: Permission): StaffRole[] {
  return [...PERMISSION_MAP[permission]];
}

/**
 * True when a role set marks the user as a customer-portal user.
 *
 * Any presence of the `customer` role routes the user to the portal
 * (fail-closed: staff never carry the customer role, so a mixed set is
 * treated as a portal user rather than granted staff-app access).
 * Used by the app-shell gate in `src/app/(app)/layout.tsx` (audit C1).
 */
export function isPortalUser(roles: readonly string[]): boolean {
  return roles.includes("customer");
}

/**
 * Portal-invite decision: may this profile's roles be replaced with
 * `['customer']`?
 *
 * Only a missing/empty profile or the untouched signup default
 * `['viewer']` qualifies — an existing staff user (any other role set)
 * is never clobbered by a customer invite. Used by
 * `src/app/api/customers/[id]/invite/route.ts` (audit C1).
 */
export function shouldAssignCustomerRole(
  roles: readonly string[] | null | undefined,
): boolean {
  if (!roles || roles.length === 0) return true;
  return roles.length === 1 && roles[0] === "viewer";
}
