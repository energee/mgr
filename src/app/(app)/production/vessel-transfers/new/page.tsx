"use client";

/**
 * New Vessel Transfer Page
 */

import { EntityForm } from "@/components/universal/entity-form";
import { vesselTransferEntity } from "@/entities/vessel-transfer";

export default function NewVesselTransferPage() {
  return (
    <EntityForm
      entity={vesselTransferEntity}
      basePath="/production/vessel-transfers"
    />
  );
}
