/**
 * User Profile Entity Configuration
 *
 * User management with role assignment and activity tracking.
 * Caches auth.users info per CLAUDE.md security guidelines.
 */

import { z } from "zod";
import Image from "next/image";
import type { EntityConfig } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";

// =============================================================================
// Types
// =============================================================================

export type UserRole = "admin" | "production_manager" | "brewer" | "sales" | "viewer" | "customer";
export type UserStatus = "active" | "inactive" | "pending";

interface UserProfile {
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
}

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
const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "production_manager", label: "Production Manager" },
  { value: "brewer", label: "Brewer" },
  { value: "sales", label: "Sales" },
  { value: "viewer", label: "Viewer" },
];

/** All roles including auto-assigned ones, for filters and display */
const ALL_ROLE_OPTIONS = [
  ...ROLE_OPTIONS,
  { value: "customer", label: "Customer" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "pending", label: "Pending" },
];

const ROLE_DISPLAY: Record<string, { label: string; color: "error" | "default" | "success" | "warning" | "info" }> = {
  admin: { label: "Admin", color: "error" },
  production_manager: { label: "Production Manager", color: "info" },
  brewer: { label: "Brewer", color: "success" },
  sales: { label: "Sales", color: "warning" },
  viewer: { label: "Viewer", color: "default" },
  customer: { label: "Customer", color: "info" },
};

const STATUS_DISPLAY: Record<string, { label: string; color: "error" | "default" | "success" | "warning" | "info" }> = {
  active: { label: "Active", color: "success" },
  inactive: { label: "Inactive", color: "default" },
  pending: { label: "Pending", color: "warning" },
};

// =============================================================================
// Entity Configuration
// =============================================================================

export const userProfileEntity: EntityConfig<UserProfile> = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  name: "user_profile",
  table: "user_profiles",
  viewTable: "user_profiles_with_details",
  displayName: "User",
  displayNamePlural: "Users",
  description: "Team members with role assignments and activity tracking",
  domain: "system",

  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "display_name",
      header: "Name",
      sortable: true,
      render: (value, row) => {
        const user = row as UserProfile;
        return (
          <div className="flex items-center gap-3">
            {user.avatar_url ? (
              <Image
                src={user.avatar_url}
                alt={String(value || "User")}
                width={32}
                height={32}
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-sm font-medium">
                {String(value || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <span className="font-medium">{String(value || "Unknown")}</span>
              {user.email && (
                <span className="text-muted-foreground text-sm block">{user.email}</span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "roles",
      header: "Roles",
      sortable: false,
      render: (value) => {
        const roles = (Array.isArray(value) ? value : [value]) as string[];
        return (
          <div className="flex flex-wrap gap-1">
            {roles.map((r) => (
              <StatusBadge key={r} status={r} config={ROLE_DISPLAY} />
            ))}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      sortable: true,
      render: (value) => (
        <StatusBadge status={String(value)} config={STATUS_DISPLAY} />
      ),
    },
    {
      accessorKey: "last_active_at",
      header: "Last Active",
      sortable: true,
      render: (value, row) => {
        const user = row as UserProfile;
        if (!value) return <span className="text-muted-foreground">Never</span>;
        if (user.days_since_active === 0) return "Today";
        if (user.days_since_active === 1) return "Yesterday";
        if (user.days_since_active != null) return `${user.days_since_active} days ago`;
        return new Date(String(value)).toLocaleDateString();
      },
    },
    {
      accessorKey: "created_at",
      header: "Joined",
      sortable: true,
      render: (value) => value ? new Date(String(value)).toLocaleDateString() : "—",
    },
  ],

  listFilters: [
    {
      field: "roles",
      type: "select",
      label: "Role",
      options: ALL_ROLE_OPTIONS,
    },
    {
      field: "status",
      type: "select",
      label: "Status",
      options: STATUS_OPTIONS,
    },
    {
      field: "display_name",
      type: "search",
      label: "Name",
    },
  ],

  defaultSort: { column: "display_name", direction: "asc" },
  searchableFields: ["display_name", "email"],

  // ---------------------------------------------------------------------------
  // Detail View
  // ---------------------------------------------------------------------------
  detailHeader: {
    title: "display_name",
    subtitle: "email",
    badge: "status",
  },

  detailSections: [
    {
      id: "profile",
      title: "Profile",
      fields: [
        { field: "display_name", label: "Display Name" },
        { field: "email", label: "Email" },
        { field: "role_display", label: "Roles" },
        { field: "status_display", label: "Status" },
      ],
    },
    {
      id: "activity",
      title: "Activity",
      fields: [
        { field: "last_active_at", label: "Last Active", format: "datetime" },
        { field: "days_since_active", label: "Days Since Active", format: "number" },
        { field: "created_at", label: "Joined", format: "date" },
      ],
    },
    {
      id: "invitation",
      title: "Invitation",
      fields: [
        { field: "invited_by_name", label: "Invited By" },
        { field: "invited_at", label: "Invited At", format: "datetime" },
      ],
      collapsible: true,
    },
  ],

  // ---------------------------------------------------------------------------
  // State Machine (for status)
  // ---------------------------------------------------------------------------
  stateMachine: {
    stateField: "status",
    initialState: "active",
    states: ["active", "inactive", "pending"],
    transitions: {
      active: ["inactive"],
      inactive: ["active"],
      pending: ["active", "inactive"],
    },
    stateDisplay: STATUS_DISPLAY,
  },

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "deactivate",
      label: "Deactivate",
      icon: "user-x",
      type: "button",
      fromStates: ["active"],
      toState: "inactive",
    },
    {
      name: "activate",
      label: "Activate",
      icon: "user-check",
      type: "button",
      fromStates: ["inactive", "pending"],
      toState: "active",
    },
    {
      name: "delete",
      label: "Delete User",
      icon: "trash",
      type: "button",
      variant: "destructive",
      fromStates: ["inactive"],
    },
  ],

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  formSchema: userProfileSchema,

  formFields: [
    {
      name: "display_name",
      label: "Display Name",
      type: "text",
      required: true,
      placeholder: "John Smith",
      colSpan: 6,
    },
    {
      name: "roles",
      label: "Roles",
      type: "select",
      options: ROLE_OPTIONS,
      required: true,
      colSpan: 12,
      description: "Select one or more roles. Permissions are additive across roles.",
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: STATUS_OPTIONS,
      colSpan: 6,
    },
    {
      name: "avatar_url",
      label: "Avatar URL",
      type: "text",
      placeholder: "https://...",
      colSpan: 6,
      description: "URL to user's profile picture",
    },
  ],

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------
  queryExamples: [
    "List all users",
    "Show admin users",
    "Who has been inactive?",
    "Find brewers",
    "Show pending invitations",
  ],

  keyFields: ["display_name", "email", "roles", "status", "last_active_at"],
};
