"use client";

/**
 * New Selling Format Page
 *
 * Create a new selling format (single, 4-pack, case, per keg).
 */

import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { sellingFormatEntity } from "@/entities/selling-format";

export default function NewSellingFormatPage() {
  return (
    <EntityDetailPage
      entity={sellingFormatEntity}
      basePath="/settings/selling-formats"
    />
  );
}
