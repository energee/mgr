/**
 * User Management Page
 *
 * List all users with role and activity information.
 */

"use client";

import { EntityList } from "@/components/universal/entity-list";
import { userProfileEntity } from "@/entities/user-profile";

export default function UsersSettingsPage() {
  return (
    <EntityList
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entity={userProfileEntity as any}
      basePath="/settings/users"
    />
  );
}
