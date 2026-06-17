/**
 * Keg Transaction Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `kegTransactionEntity` from `@/entities/keg-transaction` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { kegTransactionCore } from "./core";
import { kegTransactionPresentation } from "./presentation";

export const kegTransactionEntity = createEntityConfig(
  kegTransactionCore,
  kegTransactionPresentation,
);

// Re-export the server-safe core surface: kegTransactionCore, kegTransactionSchema,
// TRANSACTION_TYPES, KegTransaction, KegTransactionType, KegTransactionFormValues.
export * from "./core";
