/**
 * Keg Owner Entity — server-safe core
 *
 * The pure-data half of the keg owner entity: identity, the zod form schema,
 * relations, and AI metadata. No React imports — safe to import from server
 * route handlers and API routes.
 *
 * Fleet provider definitions (Owned, Microstar, KegFleet, etc.). Tracks who
 * owns each keg for logistics, deposits, and return routing.
 */

import { z } from "zod";
import type { EntityCoreInput } from "@/types/entity";

// =============================================================================
// Types
// =============================================================================

export type KegOwner = {
  id: string;
  name: string;
  code: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean;
  position: number | null;
  created_at: string | null;
  updated_at: string | null;
};

// =============================================================================
// Zod Schema
// =============================================================================

export const kegOwnerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z
    .string()
    .min(1, "Code is required")
    .regex(/^[a-z0-9_-]+$/, "Code must be lowercase alphanumeric with hyphens/underscores"),
  contact_name: z.string().nullable().optional(),
  contact_email: z.string().email("Invalid email").nullable().optional().or(z.literal("")),
  contact_phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  position: z.coerce.number().int().nullable().optional(),
});

export type KegOwnerFormValues = z.infer<typeof kegOwnerSchema>;

// =============================================================================
// Entity Core
// =============================================================================

export const kegOwnerCore: EntityCoreInput<KegOwner> = {
  name: "keg_owner",
  table: "keg_owners",
  displayName: "Keg Owner",
  defaultSort: { column: "name", direction: "asc" },
  description: "Fleet providers that own kegs (e.g., Owned, Microstar, KegFleet)",
  domain: "inventory",
  basePath: "/inventory/kegs/owners",

  searchableFields: ["name", "code", "contact_name"],

  detailHeader: {
    title: "name",
    subtitle: "code",
  },

  formSchema: kegOwnerSchema,

  relations: [
    {
      name: "deposits",
      entity: "keg_owner_deposit",
      type: "hasMany",
      foreignKey: "keg_owner_id",
      showInDetail: true,
      // The `component` (KegOwnerDepositsRelation) is supplied by
      // presentation.tsx via `relationComponents` so this module stays
      // free of React imports.
    },
  ],

  queryExamples: [
    "List all keg owners",
    "Show active fleet providers",
    "Which fleet does Microstar provide?",
  ],

  keyFields: ["name", "code", "is_active"],
};
