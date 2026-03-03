"use client";

/**
 * New Selling Format Page
 *
 * Create a new selling format (single, 4-pack, case, per keg).
 */

import { EntityDetailUnifiedWithErrorBoundary } from "@/components/universal/entity-detail-unified";
import { sellingFormatEntity } from "@/entities/selling-format";

export default function NewSellingFormatPage() {
  return (
    <EntityDetailUnifiedWithErrorBoundary
      entity={sellingFormatEntity}
      basePath="/settings/selling-formats"
    />
  );
}
