"use client";

/**
 * New Keg Transaction Page
 *
 * Supports URL parameters for pre-populating form fields:
 * - customer_id: Pre-select customer (for returns)
 * - transaction_type: Pre-select transaction type
 * - selling_format_id: Pre-select selling format
 * - order_id: Pre-select order (for ship transactions)
 */

import { useSearchParams } from "next/navigation";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { kegTransactionEntity, TRANSACTION_TYPES } from "@/entities/keg-transaction";

export default function NewKegTransactionPage() {
  const searchParams = useSearchParams();

  // Build default values from URL parameters
  const defaultValues: Record<string, unknown> = {};

  const customerId = searchParams.get("customer_id");
  if (customerId) {
    defaultValues.customer_id = customerId;
  }

  const transactionType = searchParams.get("transaction_type");
  if (transactionType) {
    defaultValues.transaction_type = transactionType;

    // Auto-set from_state and to_state based on transaction type
    const typeConfig = TRANSACTION_TYPES.find((t) => t.value === transactionType);
    if (typeConfig) {
      if (typeConfig.fromState) {
        defaultValues.from_state = typeConfig.fromState;
      }
      defaultValues.to_state = typeConfig.toState;
    }
  }

  const sellingFormatId = searchParams.get("selling_format_id");
  if (sellingFormatId) {
    defaultValues.selling_format_id = sellingFormatId;
  }

  const orderId = searchParams.get("order_id");
  if (orderId) {
    defaultValues.order_id = orderId;
  }

  return (
    <EntityDetailPage
      entity={kegTransactionEntity}
      basePath="/inventory/kegs/transactions"
      defaultValues={defaultValues}
    />
  );
}
