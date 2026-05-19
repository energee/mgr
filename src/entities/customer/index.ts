/**
 * Customer Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `customerEntity` from `@/entities/customer` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { customerCore } from "./core";
import { customerPresentation } from "./presentation";

export const customerEntity = createEntityConfig(customerCore, customerPresentation);

// Re-export the server-safe core surface: customerCore, customerSchema,
// customerTypeDisplayConfig, customerTypeOptions, Customer, CustomerFormValues.
export * from "./core";
