/**
 * Enum Value Detail Page
 */

"use client";

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { enumValueEntity } from "@/entities/enum-value";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EnumValueDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);

  return (
    <EntityDetail
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entity={enumValueEntity as any}
      id={resolvedParams.id}
      basePath="/settings/enums"
    />
  );
}
