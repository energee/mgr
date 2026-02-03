/**
 * Entity Configuration System
 *
 * This is the core abstraction for MGR. Every entity (batch, recipe, order, etc.)
 * is defined declaratively using this configuration. Universal components
 * (EntityList, EntityDetail, EntityForm) render based on these configs.
 *
 * Benefits:
 * - Single source of truth per entity
 * - AI can introspect configs to understand the system
 * - Consistent patterns across all entities
 * - Easy to add new entities
 *
 * Customization escape hatches:
 * - Custom cell renderers via `render` prop
 * - Custom dialog components via `dialogs[action].component`
 * - Custom detail sections via `sections[].component`
 */

import type { ReactNode, ComponentType } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ZodSchema } from "zod";

// =============================================================================
// Core Entity Configuration
// =============================================================================

export interface EntityConfig<T = Record<string, unknown>> {
  /** Unique identifier for this entity (e.g., 'batch', 'recipe') */
  name: string;

  /** Database table name (e.g., 'batches', 'recipes') */
  table: string;

  /** Optional view name for list display (when extra columns from joins are needed) */
  viewTable?: string;

  /** Human-readable display name (e.g., 'Batch', 'Recipe') */
  displayName: string;

  /** Plural display name (e.g., 'Batches', 'Recipes') */
  displayNamePlural: string;

  /** Brief description for AI context */
  description: string;

  /** Domain this entity belongs to */
  domain: EntityDomain;

  // ---------------------------------------------------------------------------
  // List View Configuration
  // ---------------------------------------------------------------------------

  /** Columns to display in list view */
  listColumns: EntityColumnDef<T>[];

  /** Available filters for list view */
  listFilters?: EntityFilterDef[];

  /** Default sort configuration */
  defaultSort?: { column: keyof T & string; direction: "asc" | "desc" };

  /** Searchable fields (for quick search) */
  searchableFields?: (keyof T & string)[];

  // ---------------------------------------------------------------------------
  // Detail View Configuration
  // ---------------------------------------------------------------------------

  /** Sections to display in detail view */
  detailSections?: EntitySectionDef<T>[];

  /** Header fields to show prominently */
  detailHeader?: {
    title: keyof T & string;
    subtitle?: keyof T & string;
    badge?: keyof T & string;
  };

  // ---------------------------------------------------------------------------
  // Form Configuration
  // ---------------------------------------------------------------------------

  /** Zod schema for form validation */
  formSchema: ZodSchema<Partial<T>>;

  /** Form field definitions */
  formFields: EntityFieldDef<T>[];

  /** Fields to show in create mode (defaults to all) */
  createFields?: (keyof T & string)[];

  /** Fields to show in edit mode (defaults to all) */
  editFields?: (keyof T & string)[];

  // ---------------------------------------------------------------------------
  // State Machine (for stateful entities)
  // ---------------------------------------------------------------------------

  stateMachine?: StateMachineConfig<T>;

  // ---------------------------------------------------------------------------
  // Value Display (for non-state enum fields)
  // ---------------------------------------------------------------------------

  /** Display configuration for enum/type fields (mirrors stateDisplay pattern) */
  valueDisplay?: ValueDisplayConfig[];

  // ---------------------------------------------------------------------------
  // Actions & Dialogs
  // ---------------------------------------------------------------------------

  /** Available actions for this entity */
  actions?: EntityActionDef<T>[];

  /** Dialog configurations for actions */
  dialogs?: Record<string, EntityDialogConfig<T>>;

  // ---------------------------------------------------------------------------
  // Relations
  // ---------------------------------------------------------------------------

  /** Relationships to other entities */
  relations?: EntityRelationDef[];

  // ---------------------------------------------------------------------------
  // AI Context
  // ---------------------------------------------------------------------------

  /** Example natural language queries for AI */
  queryExamples?: string[];

  /** Key fields for AI to understand */
  keyFields?: (keyof T & string)[];
}

// =============================================================================
// List View Types
// =============================================================================

export type EntityColumnDef<T> = Omit<ColumnDef<T, unknown>, "accessorKey"> & {
  /** Field key for sorting/filtering - uses string to allow view columns not in base type */
  accessorKey?: string;

  /** Whether this column is sortable */
  sortable?: boolean;

  /** Whether this column is filterable */
  filterable?: boolean;

  /** Custom render function */
  render?: (value: unknown, row: T) => ReactNode;

  /** Format type for automatic formatting */
  format?: "date" | "datetime" | "currency" | "number" | "percentage" | "unit";

  /** Unit type for unit formatting (volume, weight, temperature, gravity, retail_volume) */
  unitType?: "volume" | "weight" | "temperature" | "gravity" | "retail_volume";

  /** Related entity for FK columns (displays name from related table) */
  relation?: {
    entity: string;
    displayField: string;
  };
};

export interface EntityFilterDef {
  /** Field to filter on */
  field: string;

  /** Filter type */
  type: "select" | "multiselect" | "date" | "daterange" | "search" | "boolean";

  /** Display label */
  label: string;

  /** Options for select/multiselect (static) */
  options?: { value: string; label: string }[];

  /** Dynamic options from database table */
  dynamicOptions?: {
    table: string;
    valueField: string;
    labelField: string;
    filter?: Record<string, unknown>;
    orderBy?: string;
  };

  /** Function to fetch options dynamically (deprecated, use dynamicOptions) */
  fetchOptions?: () => Promise<{ value: string; label: string }[]>;
}

// =============================================================================
// Detail View Types
// =============================================================================

export interface EntitySectionDef<T> {
  /** Section identifier */
  id: string;

  /** Section title */
  title: string;

  /** Fields to display in this section */
  fields?: EntityFieldDisplay<T>[];

  /** Custom component to render (overrides fields) - string for lazy loading, ComponentType for direct */
  component?: ComponentType<{ data: T }> | string;

  /** Whether this section is collapsible */
  collapsible?: boolean;

  /** Default collapsed state */
  defaultCollapsed?: boolean;

  /** Tab name if using tabbed layout */
  tab?: string;
}

export interface EntityFieldDisplay<T> {
  /** Field key */
  field: keyof T & string;

  /** Display label */
  label: string;

  /** Format type */
  format?: "date" | "datetime" | "currency" | "number" | "percentage" | "json" | "unit";

  /** Unit type for unit formatting (volume, weight, temperature, gravity, retail_volume) */
  unitType?: "volume" | "weight" | "temperature" | "gravity" | "retail_volume";

  /** Related entity for FK fields (fetches display name from related table) */
  relation?: {
    entity: string;
    displayField: string;
  };

  /** Custom render function */
  render?: (value: unknown, data: T) => ReactNode;

  /** Span full width */
  fullWidth?: boolean;
}

// =============================================================================
// Form Types
// =============================================================================

export interface EntityFieldDef<T> {
  /** Field key */
  name: keyof T & string;

  /** Display label */
  label: string;

  /** Field type */
  type:
    | "text"
    | "textarea"
    | "number"
    | "select"
    | "multiselect"
    | "combobox"
    | "date"
    | "datetime"
    | "checkbox"
    | "switch"
    | "json"
    | "relation"
    | "unit";

  /** Placeholder text */
  placeholder?: string;

  /** Help text */
  description?: string;

  /** Whether field is required */
  required?: boolean;

  /** Whether field is disabled */
  disabled?: boolean;

  /** Options for select/multiselect/combobox */
  options?: { value: string; label: string }[];

  /** Function to fetch options dynamically */
  fetchOptions?: () => Promise<{ value: string; label: string }[]>;

  /** Dynamic options from database table */
  dynamicOptions?: {
    table: string;
    valueField: string;
    labelField: string;
    filter?: Record<string, unknown>;
    orderBy?: string;
  };

  /** Related entity configuration (for relation type fields) */
  relation?: {
    entity: string;
    displayField: string;
  };

  /** Default value */
  defaultValue?: unknown;

  /** Grid column span (1-12) */
  colSpan?: number;

  /** Conditional visibility */
  showWhen?: (values: Partial<T>) => boolean;

  /** Unit type for unit fields (volume, weight, temperature, gravity, retail_volume) */
  unitType?: "volume" | "weight" | "temperature" | "gravity" | "retail_volume";

  /** Allow inline unit switching (for recipe builder, brew log) */
  allowUnitSwitch?: boolean;
}

// =============================================================================
// Value Display Types (for non-state enum fields)
// =============================================================================

/**
 * Configuration for displaying enum values (like category, type, etc.).
 * Mirrors stateDisplay pattern but for non-state fields.
 */
export interface ValueDisplayConfig {
  field: string;
  display: Record<
    string,
    {
      label: string;
      color?: "default" | "success" | "warning" | "error" | "info";
    }
  >;
}

// =============================================================================
// State Machine Types
// =============================================================================

export interface StateMachineConfig<T> {
  /** Field that holds the state */
  stateField: keyof T & string;

  /** All possible states */
  states: string[];

  /** Initial state for new records */
  initialState: string;

  /** Valid transitions: { fromState: [toStates] } */
  transitions: Record<string, string[]>;

  /** State display configuration */
  stateDisplay?: Record<
    string,
    { label: string; color: "default" | "success" | "warning" | "error" | "info" }
  >;

  /** Hooks for state transitions */
  hooks?: {
    onEnter?: Record<string, (data: T) => Promise<void> | void>;
    onExit?: Record<string, (data: T) => Promise<void> | void>;
    validate?: Record<string, (data: T) => Promise<string | null> | string | null>;
  };
}

// =============================================================================
// Action Types
// =============================================================================

export interface EntityActionDef<T> {
  /** Action identifier */
  name: string;

  /** Display label */
  label: string;

  /** Icon name (lucide icon) */
  icon?: string;

  /** Action type */
  type: "button" | "dropdown";

  /** Button variant */
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";

  /** When to show this action */
  showWhen?: (data: T) => boolean;

  /** Required states (for stateful entities) */
  fromStates?: string[];

  /** Target state after action (for state transitions) */
  toState?: string;

  /** Confirm before executing */
  confirm?: boolean;

  /** Handler function */
  handler?: (data: T) => Promise<void> | void;

  /** Opens a dialog instead of direct action */
  dialog?: string;
}

// =============================================================================
// Dialog Types
// =============================================================================

export interface EntityDialogConfig<T> {
  /** Dialog title */
  title: string;

  /** Dialog description */
  description?: string;

  /** Confirm button label */
  confirmLabel?: string;

  /** Cancel button label */
  cancelLabel?: string;

  /** Button variant */
  variant?: "default" | "destructive";

  /** Require a reason/note */
  requireReason?: boolean;

  /** Custom form fields for dialog */
  fields?: EntityFieldDef<Record<string, unknown>>[];

  /** Custom component (overrides standard dialog) */
  component?: ComponentType<{ data: T; onClose: () => void; onConfirm: (data: unknown) => void }>;
}

// =============================================================================
// Relation Types
// =============================================================================

export interface EntityRelationDef {
  /** Relation name for reference */
  name: string;

  /** Related entity name */
  entity: string;

  /** Type of relation */
  type: "belongsTo" | "hasMany" | "hasOne" | "manyToMany" | "hasManyThrough";

  /** Foreign key field */
  foreignKey: string;

  /** Junction table for hasManyThrough relations */
  through?: string;

  /** Display in detail view */
  showInDetail?: boolean;

  /** Tab name if showing in tabs */
  detailTab?: string;

  /** Inline editing allowed */
  inlineEdit?: boolean;

  /** Limit for related records query (default: 50) */
  relationLimit?: number;
}

// =============================================================================
// Domain Types
// =============================================================================

export type EntityDomain =
  | "system"
  | "production"
  | "packaging"
  | "inventory"
  | "purchasing"
  | "sales"
  | "reporting";

// =============================================================================
// Registry
// =============================================================================

/**
 * Entity registry for accessing configs by name.
 * Populated by entity definition files.
 */
export const entityRegistry = new Map<string, EntityConfig<Record<string, unknown>>>();

/**
 * Register an entity configuration.
 */
export function registerEntity<T = Record<string, unknown>>(config: EntityConfig<T>): void {
  entityRegistry.set(config.name, config as EntityConfig<Record<string, unknown>>);
}

/**
 * Get an entity configuration by name.
 */
export function getEntity(name: string): EntityConfig<Record<string, unknown>> | undefined {
  return entityRegistry.get(name);
}

/**
 * Get all entities in a domain.
 */
export function getEntitiesByDomain(domain: EntityDomain): EntityConfig<Record<string, unknown>>[] {
  return Array.from(entityRegistry.values()).filter((e) => e.domain === domain);
}

/**
 * Helper to generate select options from a state machine config.
 * This eliminates the need to duplicate status options in filters and form fields.
 */
export function statesAsOptions<T>(
  stateMachine: StateMachineConfig<T>
): { value: string; label: string }[] {
  return stateMachine.states.map((state) => ({
    value: state,
    label: stateMachine.stateDisplay?.[state]?.label || formatStateLabel(state),
  }));
}

/**
 * Format a state string as a human-readable label.
 * Converts snake_case/kebab-case to Title Case.
 */
export function formatStateLabel(state: string): string {
  return state
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Get the display label for a state from an entity config.
 * Falls back to formatted state name if not defined.
 */
export function getStateLabel<T>(
  entity: EntityConfig<T>,
  state: string | null | undefined
): string {
  if (!state) return "";
  const display = entity.stateMachine?.stateDisplay?.[state];
  return display?.label || formatStateLabel(state);
}

/**
 * Get the color for a state from an entity config.
 * Falls back to "default" if not defined.
 */
export function getStateColor<T>(
  entity: EntityConfig<T>,
  state: string | null | undefined
): string {
  if (!state) return "default";
  const display = entity.stateMachine?.stateDisplay?.[state];
  return display?.color || "default";
}

// =============================================================================
// Value Display Helpers
// =============================================================================

/**
 * Convert a ValueDisplayConfig to select options.
 * Eliminates duplication of options across display config, filters, and form fields.
 */
export function valuesAsOptions(
  config: ValueDisplayConfig
): { value: string; label: string }[] {
  return Object.entries(config.display).map(([value, { label }]) => ({
    value,
    label,
  }));
}

/**
 * Get the display info for a value from an entity config.
 * Returns the full display object (label and color).
 */
export function getValueDisplay<T>(
  entity: EntityConfig<T>,
  field: string,
  value: string | null | undefined
): { label: string; color?: "default" | "success" | "warning" | "error" | "info" } | undefined {
  if (!value) return undefined;
  const config = entity.valueDisplay?.find((vd) => vd.field === field);
  return config?.display[value];
}

/**
 * Get the display label for a value from an entity config.
 * Falls back to formatted value name if not defined.
 */
export function getValueLabel<T>(
  entity: EntityConfig<T>,
  field: string,
  value: string | null | undefined
): string {
  if (!value) return "";
  const display = getValueDisplay(entity, field, value);
  return display?.label || formatStateLabel(value);
}

/**
 * Get the color for a value from an entity config.
 * Falls back to "default" if not defined.
 */
export function getValueColor<T>(
  entity: EntityConfig<T>,
  field: string,
  value: string | null | undefined
): "default" | "success" | "warning" | "error" | "info" {
  if (!value) return "default";
  const display = getValueDisplay(entity, field, value);
  return display?.color || "default";
}
