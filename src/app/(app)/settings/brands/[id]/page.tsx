"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { brandEntity } from "@/entities/brand";

export default function BrandDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityDetail
      entity={brandEntity}
      id={id}
      basePath="/settings/brands"
    />
  );
}
