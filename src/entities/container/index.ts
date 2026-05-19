/**
 * Container Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `containerEntity` from `@/entities/container` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { containerCore } from "./core";
import { containerPresentation } from "./presentation";

export const containerEntity = createEntityConfig(containerCore, containerPresentation);

// Re-export the server-safe core surface: containerCore, containerSchema,
// Container, ContainerFormValues, CONTAINER_TYPE_OPTIONS.
export * from "./core";
