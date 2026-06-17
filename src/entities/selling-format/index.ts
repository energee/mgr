/**
 * Selling Format Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `sellingFormatEntity` from `@/entities/selling-format` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { sellingFormatCore } from "./core";
import { sellingFormatPresentation } from "./presentation";

export const sellingFormatEntity = createEntityConfig(
  sellingFormatCore,
  sellingFormatPresentation,
);

// Re-export the server-safe core surface: sellingFormatCore, sellingFormatSchema,
// SellingFormat, SellingFormatFormValues.
export * from "./core";
