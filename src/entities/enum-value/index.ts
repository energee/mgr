/**
 * Enum Value Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `enumValueEntity` from `@/entities/enum-value` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { enumValueCore } from "./core";
import { enumValuePresentation } from "./presentation";

export const enumValueEntity = createEntityConfig(
  enumValueCore,
  enumValuePresentation,
);

// Re-export the server-safe core surface: enumValueCore, enumValueSchema,
// EnumValue, EnumValueFormValues, ENUM_COLORS, fetchEnumTypes.
export * from "./core";
