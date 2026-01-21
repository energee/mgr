/**
 * Edit User Page
 *
 * Edit user profile, role, and status.
 */

"use client";

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { userProfileEntity } from "@/entities/user-profile";

interface EditUserPageProps {
  params: Promise<{ id: string }>;
}

export default function EditUserPage({ params }: EditUserPageProps) {
  const { id } = use(params);

  return (
    <EntityForm
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entity={userProfileEntity as any}
      id={id}
      basePath="/settings/users"
    />
  );
}
