/**
 * Edit User Page
 *
 * Edit user profile, role, and status.
 */

"use client";

import { use } from "react";
import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
import { userProfileEntity } from "@/entities/user-profile";

interface EditUserPageProps {
  params: Promise<{ id: string }>;
}

export default function EditUserPage({ params }: EditUserPageProps) {
  const { id } = use(params);

  return (
    <EntityDetailUnified
      entity={userProfileEntity}
      id={id}
      basePath="/settings/users"
    />
  );
}
