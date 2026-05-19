/**
 * PO Receive Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `poReceiveEntity` from `@/entities/po-receive` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { poReceiveCore } from "./core";
import { poReceivePresentation } from "./presentation";

export const poReceiveEntity = createEntityConfig(
  poReceiveCore,
  poReceivePresentation,
);

// Re-export the server-safe core surface: poReceiveCore, poReceiveSchema,
// POReceive, POReceiveFormValues.
export * from "./core";
