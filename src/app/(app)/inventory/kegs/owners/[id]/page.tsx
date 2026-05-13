"use client";

import { use } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { kegOwnerEntity } from "@/entities/keg-owner";

export default function KegOwnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetailPage
      entity={kegOwnerEntity}
      id={id}
      basePath="/inventory/kegs/owners"
    />
  );
}
