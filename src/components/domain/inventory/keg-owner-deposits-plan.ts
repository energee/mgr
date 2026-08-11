export type OwnerDeposit = {
  id: string;
  keg_owner_id: string;
  selling_format_id: string;
  deposit_amount: number;
}

type DepositUpsert = Omit<OwnerDeposit, "id">;

/**
 * Decide which dirty fields become an upsert vs. a delete.
 *
 * A blank field means "no override — fall back to the container's default
 * deposit" and deletes any existing row. An explicit `0` is a distinct,
 * legitimate override (e.g. a keg owner contractually exempt from a deposit
 * for this format) and must be persisted, not deleted: every
 * `customer_keg_balances`-family view COALESCEs a missing row onto the
 * container's nonzero default (`COALESCE(kod.deposit_amount, c.deposit_amount, 0)`,
 * e.g. supabase/migrations/00191_capture_drifted_packaging_objects.sql), so
 * deleting a `0` override on save would silently reinstate a nonzero deposit
 * liability for an owner who should show $0.
 */
export function planDepositSave(
  kegOwnerId: string,
  dirtyKeys: Iterable<string>,
  deposits: Record<string, string>,
  existingDeposits: OwnerDeposit[] | undefined
): { upserts: DepositUpsert[]; deletes: string[] } {
  const upserts: DepositUpsert[] = [];
  const deletes: string[] = [];

  for (const formatId of dirtyKeys) {
    const value = deposits[formatId];
    if (!value || value.trim() === "") {
      const existing = existingDeposits?.find((d) => d.selling_format_id === formatId);
      if (existing) deletes.push(existing.id);
      continue;
    }
    upserts.push({
      keg_owner_id: kegOwnerId,
      selling_format_id: formatId,
      deposit_amount: parseFloat(value),
    });
  }

  return { upserts, deletes };
}
