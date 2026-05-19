/**
 * Packaging Session Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `packagingSessionEntity` from `@/entities/packaging-session` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { packagingSessionCore } from "./core";
import { packagingSessionPresentation } from "./presentation";

export const packagingSessionEntity = createEntityConfig(
  packagingSessionCore,
  packagingSessionPresentation,
);

// Re-export the server-safe core surface: packagingSessionCore,
// packagingSessionSchema, PackagingSession, PackagingSessionFormValues,
// packagingSessionStateMachine, statusOptions.
export * from "./core";
