"use client";

import { EntityForm } from "@/components/universal/entity-form";
import { kegTransactionEntity } from "@/entities/keg-transaction";

export default function NewKegTransactionPage() {
  return (
    <EntityForm
      entity={kegTransactionEntity}
      basePath="/inventory/kegs/transactions"
    />
  );
}
