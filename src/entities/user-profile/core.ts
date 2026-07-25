/**
 * User Profile Entity — server-safe core
 *
 * The pure-data half of the user profile entity: identity, the zod form
 * schema, state machine, and AI metadata. No React imports — safe to import
 * from server route handlers and API routes.
 *
 * User management with role assignment and activity tracking.
 * Caches auth.users info per docs/agents/db-security.md.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";
import type { UserRole } from "@/lib/permissions";

// =============================================================================
// Types
// =============================================================================

export type { UserRole };
export type UserStatus = "active" | "inactive" | "pending";

export type UserProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  roles: UserRole[];
  status: UserStatus;
  last_active_at: string | null;
  invited_at: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
  // View fields
  role_display?: string;
  status_display?: string;
  invited_by_name?: string;
  days_since_active?: number;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const userProfileSchema = z.object({
  display_name: z.string().min(1, "Display name is required"),
  roles: z.array(
    z.enum(["admin", "production_manager", "brewer", "sales", "viewer", "customer"])
  ).min(1, "At least one role is required"),
  status: z.enum(["active", "inactive", "pending"]).default("active"),
  avatar_url: z.string().url().nullable().optional(),
});

export type UserProfileFormValues = z.infer<typeof userProfileSchema>;

// =============================================================================
// Constants
// =============================================================================

/** Roles assignable by admins in the user form (excludes auto-assigned roles) */
export const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "production_manager", label: "Production Manager" },
  { value: "brewer", label: "Brewer" },
  { value: "sales", label: "Sales" },
  { value: "viewer", label: "Viewer" },
];

/** All roles including auto-assigned ones, for filters and display */
export const ALL_ROLE_OPTIONS = [
  ...ROLE_OPTIONS,
  { value: "customer", label: "Customer" },
];

export const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "pending", label: "Pending" },
];

export const ROLE_DISPLAY: Record<string, { label: string; color: "error" | "default" | "success" | "warning" | "info" }> = {
  admin: { label: "Admin", color: "error" },
  production_manager: { label: "Production Manager", color: "info" },
  brewer: { label: "Brewer", color: "success" },
  sales: { label: "Sales", color: "warning" },
  viewer: { label: "Viewer", color: "default" },
  customer: { label: "Customer", color: "info" },
};

export const STATUS_DISPLAY: Record<string, { label: string; color: "error" | "default" | "success" | "warning" | "info" }> = {
  active: { label: "Active", color: "success" },
  inactive: { label: "Inactive", color: "default" },
  pending: { label: "Pending", color: "warning" },
};

// =============================================================================
// Entity Core
// =============================================================================

export const userProfileCore: EntityCoreInput<UserProfile> = {
  name: "user_profile",
  table: "user_profiles",
  viewTable: "user_profiles_with_details",
  displayName: "User",
  domain: "system",
  basePath: "/settings/users",

  defaultSort: { column: "display_name", direction: "asc" },
  searchableFields: ["display_name", "email"],

  detailHeader: {
    title: "display_name",
    subtitle: "email",
    badge: "status",
  },

  formSchema: userProfileSchema,

  stateMachine: {
    stateField: "status",
    initialState: "active",
    states: ["active", "inactive", "pending"],
    transitions: {
      active: ["inactive"],
      inactive: ["active"],
      pending: ["active", "inactive"],
    },
    // These targets require the server command that coordinates the DB gate
    // with the Supabase Auth ban. Generic/bulk status UPDATEs are suppressed.
    requiresAction: {
      inactive: "deactivate",
      active: "reactivate",
    },
    stateDisplay: STATUS_DISPLAY,
  },

  keyFields: ["display_name", "email", "roles", "status", "last_active_at"],
};
