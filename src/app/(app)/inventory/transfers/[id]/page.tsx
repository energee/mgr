"use client";

/**
 * Location Transfer Detail Page
 *
 * Renders the transfer detail view with a custom action handler for the
 * "Ship" action, which opens the ShipTransferDialog for partial/full shipment.
 */

import { use, useCallback, useState } from "react";
import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { locationTransferEntity } from "@/entities/location-transfer";
import { ShipTransferDialog } from "@/components/domain/ship-transfer-dialog";

export default function TransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [shipDialogOpen, setShipDialogOpen] = useState(false);

  const handleAction = useCallback(
    (actionName: string): boolean => {
      if (actionName === "ship") {
        setShipDialogOpen(true);
        return true; // Handled — prevent default state transition
      }
      return false; // Let other actions use default behavior
    },
    []
  );

  return (
    <>
      <EntityDetailUnifiedWithErrorBoundary
        entity={locationTransferEntity}
        id={id}
        basePath="/inventory/transfers"
        onAction={handleAction}
      />
      <ShipTransferDialog
        transferId={id}
        open={shipDialogOpen}
        onClose={() => setShipDialogOpen(false)}
      />
    </>
  );
}
