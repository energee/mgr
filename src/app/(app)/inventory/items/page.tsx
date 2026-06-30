"use client";

/**
 * Inventory Items List Page
 *
 * Items list with an On Hand column (per-item lot totals) and a guided
 * Count / Adjust action (audit finding 27) so cycle counts start here
 * instead of the raw-UUID allocation form.
 */

import { useState } from "react";
import { EntityList } from "@/components/universal/entity-list";
import { inventoryItemEntity } from "@/entities/inventory-item";
import { Button } from "@/components/ui/button";
import { ClipboardCheck } from "lucide-react";
import { CountAdjustDialog } from "@/components/domain/inventory/count-adjust-dialog";

export default function InventoryItemsPage() {
  const [countOpen, setCountOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setCountOpen(true)}>
          <ClipboardCheck className="h-4 w-4 mr-2" />
          Count / Adjust
        </Button>
      </div>

      <EntityList entity={inventoryItemEntity} basePath="/inventory/items" />

      <CountAdjustDialog open={countOpen} onOpenChange={setCountOpen} />
    </div>
  );
}
