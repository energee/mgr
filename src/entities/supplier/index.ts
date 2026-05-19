/**
 * Supplier Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `supplierEntity` from `@/entities/supplier` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { supplierCore } from "./core";
import { supplierPresentation } from "./presentation";

export const supplierEntity = createEntityConfig(supplierCore, supplierPresentation);

// Re-export the server-safe core surface: supplierCore, supplierSchema,
// SupplierFormValues.
export * from "./core";
