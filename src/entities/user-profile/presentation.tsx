/**
 * User Profile Entity — presentation
 *
 * The React/UI half of the user profile entity: list columns, list filters,
 * unified detail/edit sections, and actions.
 */

import type { ReactNode } from "react";
import Image from "next/image";
import type { EntityPresentation } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import {
  ROLE_OPTIONS,
  ALL_ROLE_OPTIONS,
  STATUS_OPTIONS,
  ROLE_DISPLAY,
  STATUS_DISPLAY,
} from "./core";
import type { UserProfile } from "./core";

/** Renders an array of role strings as colored badges. */
function renderRoleBadges(value: unknown): ReactNode {
  const roles = (Array.isArray(value) ? value : [value]) as string[];
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <StatusBadge key={r} status={r} config={ROLE_DISPLAY} />
      ))}
    </div>
  );
}

export const userProfilePresentation: EntityPresentation<UserProfile> = {
  // ---------------------------------------------------------------------------
  // List View
  // ---------------------------------------------------------------------------
  listColumns: [
    {
      accessorKey: "display_name",
      header: "Name",
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
      render: renderRoleBadges,
    },
    {
      accessorKey: "status",
      header: "Status",
      render: (value) => (
        <StatusBadge status={String(value)} config={STATUS_DISPLAY} />
      ),
    },
    {
      accessorKey: "last_active_at",
      header: "Last Active",
      render: (value, row) => {
        const user = row as UserProfile;
        if (!value) return <span className="text-muted-foreground">Never</span>;
        if (user.days_since_active === 0) return "Today";
        if (user.days_since_active === 1) return "Yesterday";
        if (user.days_since_active != null) return `${user.days_since_active} days ago`;
        return new Date(String(value)).toLocaleDateString("en-US");
      },
    },
    {
      accessorKey: "created_at",
      header: "Joined",
      render: (value) => value ? new Date(String(value)).toLocaleDateString("en-US") : "—",
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

  // ---------------------------------------------------------------------------
  // Unified Sections (detail + edit)
  // ---------------------------------------------------------------------------
  sections: [
    {
      id: "profile",
      title: "Profile",
      fields: [
        {
          name: "display_name",
          label: "Display Name",
          type: "text",
          required: true,
          placeholder: "John Smith",
          colSpan: 6,
        },
        {
          name: "email",
          label: "Email",
          editable: false,
          colSpan: 6,
        },
        {
          name: "roles",
          label: "Roles",
          type: "multiselect",
          options: ROLE_OPTIONS,
          required: true,
          description: "Select one or more roles. Permissions are additive across roles.",
          render: renderRoleBadges,
          colSpan: 12,
        },
        {
          name: "status",
          label: "Status",
          editable: false,
          description: "Use Deactivate or Reactivate so login access changes safely.",
          colSpan: 6,
        },
        {
          name: "avatar_url",
          label: "Avatar URL",
          type: "text",
          placeholder: "https://...",
          description: "URL to user's profile picture",
          colSpan: 6,
        },
      ],
    },
    {
      id: "activity",
      title: "Activity",
      fields: [
        {
          name: "last_active_at",
          label: "Last Active",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
        {
          name: "days_since_active",
          label: "Days Since Active",
          format: "number",
          editable: false,
          colSpan: 6,
        },
        {
          name: "created_at",
          label: "Joined",
          format: "date",
          editable: false,
          colSpan: 6,
        },
      ],
    },
    {
      id: "invitation",
      title: "Invitation",
      collapsible: true,
      fields: [
        {
          name: "invited_by_name",
          label: "Invited By",
          editable: false,
          colSpan: 6,
        },
        {
          name: "invited_at",
          label: "Invited At",
          format: "datetime",
          editable: false,
          colSpan: 6,
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: [
    {
      name: "deactivate",
      label: "Deactivate",
      icon: "user-x",
      type: "button",
      fromStates: ["active", "pending"],
      toState: "inactive",
    },
    {
      name: "reactivate",
      label: "Reactivate",
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
};
