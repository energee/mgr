"use client";

/**
 * Edit Vessel Page
 */

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { vesselEntity } from "@/entities/vessel";

export default function EditVesselPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityForm
      entity={vesselEntity}
      id={id}
      basePath="/production/vessels"
    />
  );
}
