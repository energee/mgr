"use client";

/**
 * New Vessel Page
 */

import { EntityForm } from "@/components/universal/entity-form";
import { vesselEntity } from "@/entities/vessel";

export default function NewVesselPage() {
  return (
    <EntityForm
      entity={vesselEntity}
      basePath="/production/vessels"
    />
  );
}
