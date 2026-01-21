/**
 * Invite User Page
 *
 * Create a new user invitation.
 * Note: Full invitation flow requires additional setup (email service).
 * For now, this creates a user profile record.
 */

"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { userProfileEntity } from "@/entities/user-profile";

export default function NewUserPage() {
  return (
    <EntityForm
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entity={userProfileEntity as any}
      basePath="/settings/users"
    />
  );
}
