"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { kegOwnerEntity } from "@/entities/keg-owner";

export default function KegOwnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <EntityDetail
      entity={kegOwnerEntity}
      id={id}
      basePath="/inventory/kegs/owners"
    />
  );
}
