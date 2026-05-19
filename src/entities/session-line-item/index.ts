/**
 * Session Line Item Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `sessionLineItemEntity` from `@/entities/session-line-item` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { sessionLineItemCore } from "./core";
import { sessionLineItemPresentation } from "./presentation";

export const sessionLineItemEntity = createEntityConfig(
  sessionLineItemCore,
  sessionLineItemPresentation,
);

// Re-export the server-safe core surface: sessionLineItemCore, sessionLineItemSchema,
// SessionLineItem, SessionLineItemFormValues.
export * from "./core";
