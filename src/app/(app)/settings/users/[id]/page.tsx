/**
 * User Profile Detail Page
 *
 * View user details including role, activity, and invitation info.
 */

"use client";

import { use } from "react";
import { EntityDetailUnified } from "@/components/universal/entity-detail-unified";
import { userProfileEntity } from "@/entities/user-profile";

interface UserDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = use(params);

  return (
    <EntityDetailUnified
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entity={userProfileEntity as any}
      id={id}
      basePath="/settings/users"
    />
  );
}
