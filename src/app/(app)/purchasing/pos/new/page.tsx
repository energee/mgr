"use client";

/**
 * New Purchase Order page.
 *
 * Prefills po_number with the next suggestion in the PO-YYYY-NNN sequence
 * (race-safe generate_next_po_number(), migration 00142) so manually created
 * POs share one sequence with the automated demand→PO flow instead of the
 * user inventing numbers by hand. The suggestion stays editable; the
 * po_number UNIQUE constraint backstops concurrent suggestions at save. A
 * ?po_number= deep link suppresses the fetch — EntityDetailPage merges URL
 * params into the form defaults itself.
 */

import { useSearchParams } from "next/navigation";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { Skeleton } from "@/components/ui/skeleton";
import { purchaseOrderEntity } from "@/entities/purchase-order";
import { generateNextPONumber } from "@/domain/purchasing/po-generator";
import { useSuggestedNumber } from "@/hooks/use-suggested-number";

export default function NewPurchaseOrderPage() {
  const searchParams = useSearchParams();
  const { suggested, resolved } = useSuggestedNumber(
    generateNextPONumber,
    searchParams.has("po_number"),
  );

  // Form defaults are captured at mount — hold rendering until the
  // suggestion resolves (or fails, falling back to manual entry).
  if (!resolved) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <EntityDetailPage
      entity={purchaseOrderEntity}
      basePath="/purchasing/pos"
      defaultValues={suggested ? { po_number: suggested } : undefined}
    />
  );
}
