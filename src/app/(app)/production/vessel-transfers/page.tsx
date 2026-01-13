"use client";

/**
 * Vessel Transfers List Page
 *
 * Displays all vessel transfers using the universal EntityList component.
 */

import { EntityList } from "@/components/universal/entity-list";
import { vesselTransferEntity } from "@/entities/vessel-transfer";

export default function VesselTransfersPage() {
  return (
    <EntityList
      entity={vesselTransferEntity}
      basePath="/production/vessel-transfers"
    />
  );
}
