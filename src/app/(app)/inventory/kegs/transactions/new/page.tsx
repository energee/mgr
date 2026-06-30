"use client";

/**
 * New Keg Transaction Page
 *
 * URL-parameter pre-fill (customer_id, transaction_type, selling_format_id,
 * order_id, packaging_session_id, ...) is handled generically by
 * EntityDetailPage, which merges search params matching form fields into the
 * create form's default values.
 *
 * from_state/to_state correctness does NOT depend on this page: the
 * authoritative derivation lives in kegTransactionSchema's z.preprocess step
 * (src/entities/keg-transaction.tsx), which fills states from
 * TRANSACTION_TYPES at submit time for every entry point — including the bare
 * /new page and mid-form type changes. The defaults below only pre-fill the
 * state selects when a transaction_type arrives via URL, so the fields that
 * ARE visible (e.g. for adjust/maintain/retire) agree with the pre-selected
 * type from the start.
 */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { kegTransactionEntity, TRANSACTION_TYPES } from "@/entities/keg-transaction";

export default function NewKegTransactionPage() {
  const searchParams = useSearchParams();
  const transactionType = searchParams.get("transaction_type");

  const defaultValues = useMemo(() => {
    const typeConfig = TRANSACTION_TYPES.find(
      (t) => t.value === transactionType,
    );
    if (!typeConfig) return undefined;

    const derived: Record<string, unknown> = { to_state: typeConfig.toState };
    if (typeConfig.fromState) {
      derived.from_state = typeConfig.fromState;
    }
    return derived;
  }, [transactionType]);

  return (
    <EntityDetailPage
      entity={kegTransactionEntity}
      basePath="/inventory/kegs/transactions"
      defaultValues={defaultValues}
    />
  );
}
