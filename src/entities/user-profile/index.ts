/**
 * User Profile Entity — assembled config
 *
 * Joins the server-safe core (`core.ts`) with the React presentation half
 * (`presentation.tsx`) into the full `EntityConfig`. Existing callers import
 * `userProfileEntity` from `@/entities/user-profile` unchanged.
 */

import { createEntityConfig } from "@/types/entity";
import { userProfileCore } from "./core";
import { userProfilePresentation } from "./presentation";

export const userProfileEntity = createEntityConfig(
  userProfileCore,
  userProfilePresentation,
);

// Re-export the server-safe core surface: userProfileCore, userProfileSchema,
// ROLE_OPTIONS, ALL_ROLE_OPTIONS, STATUS_OPTIONS, ROLE_DISPLAY, STATUS_DISPLAY,
// UserRole, UserStatus, UserProfile, UserProfileFormValues.
export * from "./core";
