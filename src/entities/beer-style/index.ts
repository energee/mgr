/**
 * Beer Style Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `beerStyleEntity` from `@/entities/beer-style` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { beerStyleCore } from "./core";
import { beerStylePresentation } from "./presentation";

export const beerStyleEntity = createEntityConfig(
  beerStyleCore,
  beerStylePresentation,
);

// Re-export the server-safe core surface: beerStyleCore, beerStyleSchema,
// BeerStyle, BeerStyleFormValues.
export * from "./core";
