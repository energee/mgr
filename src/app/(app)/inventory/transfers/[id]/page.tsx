"use client";

/**
 * Location Transfer Detail Page
 *
 * Renders the transfer detail view with a custom action handler for the
 * "Ship" action, which opens the ShipTransferDialog for partial/full shipment.
 */

import { use, useCallback, useState } from "react";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
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
        return true;
      }
      return false;
    },
    []
  );

  return (
    <>
      <EntityDetailPage
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
