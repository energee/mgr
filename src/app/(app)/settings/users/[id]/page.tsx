/**
 * User Profile Detail Page
 *
 * View user details including role, activity, and invitation info.
 */

"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { userProfileEntity } from "@/entities/user-profile";
import { useUserAccountStatusCommand } from "@/hooks/use-user-account-status-command";

type UserDetailPageProps = {
  params: Promise<{ id: string }>;
}

export default function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = use(params);
  const { handleUserStatusAction } = useUserAccountStatusCommand();

  return (
    <EntityDetailPage
      entity={userProfileEntity}
      id={id}
      basePath="/settings/users"
      onAction={handleUserStatusAction}
    />
  );
}
