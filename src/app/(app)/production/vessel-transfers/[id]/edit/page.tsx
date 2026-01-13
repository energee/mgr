"use client";

/**
 * Edit Vessel Transfer Page
 */

import { use } from "react";
import { EntityForm } from "@/components/universal/entity-form";
import { vesselTransferEntity } from "@/entities/vessel-transfer";

export default function EditVesselTransferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <EntityForm
      entity={vesselTransferEntity}
      id={id}
      basePath="/production/vessel-transfers"
    />
  );
}
