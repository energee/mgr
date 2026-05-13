/**
 * Edit User Page
 *
 * Edit user profile, role, and status.
 */

"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { userProfileEntity } from "@/entities/user-profile";

type EditUserPageProps = {
  params: Promise<{ id: string }>;
}

export default function EditUserPage({ params }: EditUserPageProps) {
  const { id } = use(params);

  return (
    <EntityDetailPage
      entity={userProfileEntity}
      id={id}
      basePath="/settings/users"
    />
  );
}
