/**
 * Vessel Entity — server-safe core
 *
 * The pure-data half of the vessel entity: identity, the zod form schema,
 * state machine, value display, relations, and AI metadata. No React imports
 * — safe to import from server route handlers and API routes.
 *
 * Vessels are the physical containers used in the brewing process:
 * fermenters, brites, kettles, mash tuns, HLTs, unitanks, foeders, barrels,
 * and brinks.
 *
 * State machine tracks the cleaning workflow:
 * dirty → caustic_cleaned → ready_for_use → in_use → dirty
 * Plus maintenance as escape hatch from any state.
 */

import { z } from "zod";
import type { EntityCoreInput, StateMachineConfig, ValueDisplayConfig } from "@/types/entity";
import { statesAsOptions, valuesAsOptions } from "@/types/entity";
import type { Database } from "@/types/supabase";

// Base type from vessels table
export type Vessel = Database["public"]["Tables"]["vessels"]["Row"];

// =============================================================================
// Vessel Type Constants
// =============================================================================

export const VESSEL_TYPES = [
  { value: "fermenter", label: "Fermenter" },
  { value: "brite", label: "Brite Tank" },
  { value: "kettle", label: "Kettle" },
  { value: "mash_tun", label: "Mash Tun" },
  { value: "hlt", label: "HLT" },
  { value: "unitank", label: "Unitank" },
  { value: "foeder", label: "Foeder" },
  { value: "barrel", label: "Barrel" },
  { value: "brink", label: "Brink" },
] as const;

export type VesselType = (typeof VESSEL_TYPES)[number]["value"];

// =============================================================================
// Value Display Configuration
// =============================================================================

export const vesselTypeDisplayConfig: ValueDisplayConfig = {
  field: "vessel_type",
  display: {
    fermenter: { label: "Fermenter" },
    brite: { label: "Brite Tank" },
    kettle: { label: "Kettle" },
    mash_tun: { label: "Mash Tun" },
    hlt: { label: "HLT" },
    unitank: { label: "Unitank" },
    foeder: { label: "Foeder" },
    barrel: { label: "Barrel" },
    brink: { label: "Brink" },
  },
};

// =============================================================================
// Zod Schema
// =============================================================================

export const vesselSchema = z.object({
  name: z.string().min(1, "Name is required"),
  vessel_type: z.enum([
    "fermenter",
    "brite",
    "kettle",
    "mash_tun",
    "hlt",
    "unitank",
    "foeder",
    "barrel",
    "brink",
  ]),
  capacity_bbl: z.coerce.number().min(0, "Capacity must be positive"),
  location_id: z.string().uuid().nullable().optional(),
  status: z.enum(["dirty", "caustic_cleaned", "ready_for_use", "in_use", "maintenance"]).default("ready_for_use"),
  current_batch_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

export type VesselFormValues = z.infer<typeof vesselSchema>;

// =============================================================================
// State Machine
// =============================================================================

export const vesselStateMachine: StateMachineConfig<Vessel> = {
  stateField: "status",
  states: ["dirty", "caustic_cleaned", "ready_for_use", "in_use", "maintenance"],
  initialState: "ready_for_use",
  transitions: {
    dirty: ["caustic_cleaned", "ready_for_use", "maintenance"],
    caustic_cleaned: ["ready_for_use", "maintenance"],
    ready_for_use: ["in_use", "maintenance"],
    in_use: ["dirty", "maintenance"],
    maintenance: ["dirty"],
  },
  stateDisplay: {
    dirty: { label: "Dirty", color: "warning" },
    caustic_cleaned: { label: "Caustic Cleaned", color: "info" },
    ready_for_use: { label: "Ready", color: "success" },
    in_use: { label: "In Use", color: "default" },
    maintenance: { label: "Maintenance", color: "error" },
  },
};

// Derive status options from state machine
export const statusOptions = statesAsOptions(vesselStateMachine);

// Vessel type options - derived from valueDisplay config
export const vesselTypeOptions = valuesAsOptions(vesselTypeDisplayConfig);

// =============================================================================
// Entity Core
// =============================================================================

export const vesselCore: EntityCoreInput<Vessel> = {
  name: "vessel",
  table: "vessels",
  viewTable: "vessels_with_batch",
  displayName: "Vessel",
  description: "Brewing vessels including fermenters, brites, kettles, and more",
  domain: "production",

  // defaultSort: { column: "name", direction: "asc" } — omitted (matches default)
  // searchableFields: ["name"] — omitted (matches default)

  stateMachine: vesselStateMachine,

  valueDisplay: [vesselTypeDisplayConfig],

  detailHeader: {
    title: "name",
    badge: "status",
  },

  formSchema: vesselSchema,

  relations: [
    {
      name: "location",
      entity: "location",
      type: "belongsTo",
      foreignKey: "location_id",
      showInDetail: true,
    },
    {
      name: "current_batch",
      entity: "batch",
      type: "belongsTo",
      foreignKey: "current_batch_id",
      showInDetail: true,
    },
    {
      name: "transfers_to",
      entity: "vessel_transfer",
      type: "hasMany",
      foreignKey: "to_vessel_id",
      showInDetail: true,
      detailTab: "Transfer History",
    },
  ],

  queryExamples: [
    "Show me all available fermenters",
    "Which vessels are currently in use?",
    "What's in FV-1?",
    "List dirty vessels that need cleaning",
    "Find vessels under maintenance",
    "What's the total fermenter capacity?",
  ],

  keyFields: ["name", "vessel_type", "capacity_bbl", "status"],
};
