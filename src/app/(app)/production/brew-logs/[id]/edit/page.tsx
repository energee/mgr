"use client";

/**
 * Edit Brew Log Page
 */

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { brewLogEntity } from "@/entities/brew-log";

export default function EditBrewLogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityForm
      entity={brewLogEntity}
      id={id}
      basePath="/production/brew-logs"
    />
  );
}
