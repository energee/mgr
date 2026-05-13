/**
 * User Profile Detail Page
 *
 * View user details including role, activity, and invitation info.
 */

"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { userProfileEntity } from "@/entities/user-profile";

type UserDetailPageProps = {
  params: Promise<{ id: string }>;
}

export default function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = use(params);

  return (
    <EntityDetailPage
      entity={userProfileEntity}
      id={id}
      basePath="/settings/users"
    />
  );
}
