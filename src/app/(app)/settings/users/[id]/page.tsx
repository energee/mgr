/**
 * User Profile Detail Page
 *
 * View user details including role, activity, and invitation info.
 */

"use client";

import { use } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { userProfileEntity } from "@/entities/user-profile";

type UserDetailPageProps = {
  params: Promise<{ id: string }>;
}

export default function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = use(params);

  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={userProfileEntity}
      id={id}
      basePath="/settings/users"
    />
  );
}
