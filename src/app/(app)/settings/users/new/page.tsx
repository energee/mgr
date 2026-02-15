/**
 * Invite User Page
 *
 * Create a new user invitation.
 * Note: Full invitation flow requires additional setup (email service).
 * For now, this creates a user profile record.
 */

"use client";

import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
import { userProfileEntity } from "@/entities/user-profile";

export default function NewUserPage() {
  return (
    <EntityDetailUnified
      entity={userProfileEntity}
      basePath="/settings/users"
    />
  );
}
