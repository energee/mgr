"use client";

/**
 * Brew Log Detail Page
 */

import { use } from "react";
import { EntityDetail } from "@/components/universal/entity-detail";
import { brewLogEntity } from "@/entities/brew-log";

export default function BrewLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityDetail
      entity={brewLogEntity}
      id={id}
      basePath="/production/brew-logs"
    />
  );
}
