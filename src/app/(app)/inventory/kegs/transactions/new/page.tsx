"use client";

/**
 * New Keg Transaction Page
 *
 * Supports URL parameters for pre-populating form fields:
 * - customer_id: Pre-select customer (for returns)
 * - transaction_type: Pre-select transaction type
 * - keg_type_id: Pre-select keg type
 * - order_id: Pre-select order (for ship transactions)
 */

import { useSearchParams } from "next/navigation";
import { EntityForm } from "@/components/universal/entity-form";
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

  const kegTypeId = searchParams.get("keg_type_id");
  if (kegTypeId) {
    defaultValues.keg_type_id = kegTypeId;
  }

  const orderId = searchParams.get("order_id");
  if (orderId) {
    defaultValues.order_id = orderId;
  }

  return (
    <EntityForm
      entity={kegTransactionEntity}
      basePath="/inventory/kegs/transactions"
      defaultValues={defaultValues}
    />
  );
}
