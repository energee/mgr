"use client";

import { EntityList } from "@/components/universal/entity-list";
import { kegTransactionEntity } from "@/entities/keg-transaction";

export default function KegTransactionsPage() {
  return (
    <EntityList
      entity={kegTransactionEntity}
      basePath="/inventory/kegs/transactions"
      showCreate={true}
    />
  );
}
