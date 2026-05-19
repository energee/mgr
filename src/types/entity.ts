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

import type { ReactNode, ComponentType, FC } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ZodSchema } from "zod";

// =============================================================================
// Entity Configuration — Core / Presentation split
// =============================================================================
//
// An entity definition has two halves:
//
//   EntityCore         — pure, serializable data. No React imports. Safe to
//                        import from server route handlers, API routes, and
//                        edge functions. Holds identity, the zod formSchema,
//                        the state machine, relations, and AI metadata.
//   EntityPresentation — the React/UI half: list columns, filters, detail
//                        sections, actions, dialogs, kanban board config.
//
// `EntityConfig = EntityCore & EntityPresentation`, so every existing consumer
// is unaffected. Per-entity files keep the two halves in separate modules
// (`core.ts` / `presentation.tsx`) and assemble them with `createEntityConfig()`
// in `src/entities/<name>/index.ts`.

/**
 * Server-safe half of an entity definition: pure data, no React.
 *
 * `core.ts` modules only import `zod`, generated `Database` types, and the
 * type-level helpers here — making them importable from server code.
 */
export type EntityCore<T = Record<string, unknown>> = {
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

  /** Default sort configuration */
  defaultSort?: { column: keyof T & string; direction: "asc" | "desc" };

  /** Searchable fields (for quick search) */
  searchableFields?: (keyof T & string)[];

  /**
   * Header fields to show prominently. Pure field-name strings — consumed by
   * the chat route to build entity context summaries, so it lives in core.
   */
  detailHeader?: {
    title: keyof T & string;
    subtitle?: keyof T & string;
    badge?: keyof T & string;
  };

  /** Zod schema for form validation. The shared contract for forms and AI writes. */
  formSchema: ZodSchema<Partial<T>>;

  /** State machine (for stateful entities) */
  stateMachine?: StateMachineConfig<T>;

  /** Display configuration for enum/type fields (mirrors stateDisplay pattern) */
  valueDisplay?: ValueDisplayConfig[];

  /** Relationships to other entities */
  relations?: EntityRelationDef[];

  /** Example natural language queries for AI */
  queryExamples?: string[];

  /** Key fields for AI to understand */
  keyFields?: (keyof T & string)[];
}

/**
 * Client-only half of an entity definition: the list / detail / form UI.
 *
 * `presentation.tsx` modules may import React and client components freely.
 */
export type EntityPresentation<T = Record<string, unknown>> = {
  /** Columns to display in list view */
  listColumns: EntityColumnDef<T>[];

  /** Available filters for list view */
  listFilters?: EntityFilterDef[];

  /** Quick filter tabs above the toolbar (presets that set URL filters on click) */
  quickFilters?: QuickFilterDef[];

  /** @deprecated Use `sections` instead. Will be removed in a future update. */
  detailSections?: EntitySectionDef<T>[];

  /** Unified sections for combined detail/edit view. Takes precedence over detailSections + formFields. */
  sections?: UnifiedSectionDef<T>[];

  /** @deprecated Use `sections` instead. Kept for backward compatibility. */
  formFields?: EntityFieldDef<T>[];

  /** @deprecated Use `sections` with `editable: "create-only"` instead. */
  createFields?: (keyof T & string)[];

  /** @deprecated Use `sections` with `editable` control instead. */
  editFields?: (keyof T & string)[];

  /** Kanban board config. Requires stateMachine. */
  kanbanConfig?: KanbanConfig<T>;

  /** Available actions for this entity */
  actions?: EntityActionDef<T>[];

  /** Dialog configurations for actions */
  dialogs?: Record<string, EntityDialogConfig<T>>;

  /**
   * React components for relation tabs, keyed by relation name. The relation
   * data itself lives in `EntityCore.relations` (server-safe); the matching
   * component is supplied here so `core.ts` stays free of React imports.
   * `createEntityConfig()` weaves each component onto its relation.
   */
  relationComponents?: Record<
    string,
    ComponentType<{ parentId: string; data?: Record<string, unknown> }>
  >;
}

/**
 * Full entity configuration — the assembled core + presentation. Universal
 * components (EntityList, EntityDetail, EntityForm) render from this.
 */
export type EntityConfig<T = Record<string, unknown>> = EntityCore<T> &
  EntityPresentation<T>;

/**
 * Fields `createEntityConfig()` fills with a default when a per-entity
 * `core.ts` omits them, so the common case stays terse:
 *
 *   displayNamePlural → `${displayName}s`
 *   searchableFields  → ["name"]
 *   defaultSort       → { column: "name", direction: "asc" } — only when a
 *                       "name" column exists in listColumns
 *
 * Entities opt out with explicit values — an irregular plural ("Batch" →
 * "Batches"), a non-name sort column, or `searchableFields: []` to disable
 * quick search. A nameless entity (no "name" column) that omits defaultSort
 * keeps an undefined sort; it should set searchableFields explicitly.
 */
type DefaultableCoreField = "displayNamePlural" | "searchableFields" | "defaultSort";

/**
 * The core shape a per-entity `core.ts` passes to `createEntityConfig()`.
 * Identical to `EntityCore` except the three defaultable fields may be
 * omitted. A complete `EntityCore` is also assignable here.
 */
export type EntityCoreInput<T = Record<string, unknown>> = Omit<
  EntityCore<T>,
  DefaultableCoreField
> &
  Partial<Pick<EntityCore<T>, DefaultableCoreField>>;

/**
 * Assemble an EntityConfig from its server-safe core and its presentation half.
 * Every per-entity `index.ts` goes through this single seam. It supplies
 * safe-field defaults (see `DefaultableCoreField`) and weaves any
 * `relationComponents` onto their matching `core.relations` entry.
 */
export function createEntityConfig<T>(
  core: EntityCoreInput<T>,
  presentation: EntityPresentation<T>,
): EntityConfig<T> {
  const { relationComponents, ...presentationFields } = presentation;

  const relations =
    relationComponents && core.relations
      ? core.relations.map((relation) =>
          relationComponents[relation.name]
            ? { ...relation, component: relationComponents[relation.name] }
            : relation,
        )
      : core.relations;

  // The name-sorted defaultSort is only safe when a "name" column actually
  // exists. Nameless entities (join rows like session_line_item) that omit
  // defaultSort keep an undefined sort rather than a broken one.
  const hasNameColumn = presentationFields.listColumns.some(
    (column) => column.accessorKey === "name",
  );

  return {
    ...core,
    displayNamePlural: core.displayNamePlural ?? `${core.displayName}s`,
    searchableFields: core.searchableFields ?? (["name"] as (keyof T & string)[]),
    defaultSort:
      core.defaultSort ??
      (hasNameColumn
        ? ({ column: "name", direction: "asc" } as EntityCore<T>["defaultSort"])
        : undefined),
    relations,
    ...presentationFields,
  };
}

/**
 * Build the standard destructive delete action. Every entity that supports
 * deletion declares the same `{ name, icon, type, variant }` shape — this
 * helper builds it so each `presentation.tsx` only states the noun and, on
 * the rare soft-delete entity, the mode.
 *
 * @param noun Entity noun for the label, e.g. "Profile" → "Delete Profile".
 * @param mode "hard" (default) issues a DELETE; "soft" sets is_active = false.
 */
export function deleteAction<T>(
  noun: string,
  mode: "hard" | "soft" = "hard",
): EntityActionDef<T> {
  return {
    name: "delete",
    label: `Delete ${noun}`,
    icon: "trash",
    type: "dropdown",
    variant: "destructive",
    deleteMode: mode,
  };
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

export type QuickFilterDef = {
  /** Tab label (e.g., "Active", "Completed") */
  label: string;

  /** Filter presets to apply when this tab is selected */
  filters: {
    /** Column id to filter on */
    column: string;
    /** Values to filter by */
    values: string[];
  }[];

  /** Whether this tab is selected by default */
  isDefault?: boolean;

  /** Override default sort when this tab is active */
  sort?: { column: string; direction: "asc" | "desc" };
}

export type EntityFilterDef = {
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

export type EntitySectionDef<T> = {
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

export type EntityFieldDisplay<T> = {
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

export type EntityFieldDef<T> = {
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
// Unified Detail/Edit Types
// =============================================================================

/**
 * Unified field definition for the combined detail/edit view.
 * Each field knows how to render in both display (view) and input (edit) mode.
 * Merges the concepts of EntityFieldDisplay (view) and EntityFieldDef (edit).
 */
export type UnifiedFieldDef<T = Record<string, unknown>> = {
  /** Field key (maps to record property) */
  name: keyof T & string;

  /** Display label */
  label: string;

  // -- Layout (shared) --

  /** Grid column span (1-12). Controls layout in both view and edit modes. */
  colSpan?: number;

  /** Span full width (alternative to colSpan: 12) */
  fullWidth?: boolean;

  // -- Display mode props --

  /** Custom render function for view mode */
  render?: (value: unknown, data: T) => ReactNode;

  /** Format type for automatic formatting in view mode */
  format?: "date" | "datetime" | "currency" | "number" | "percentage" | "json" | "unit";

  // -- Edit mode props --

  /** Input type for edit mode. If omitted, field is display-only. */
  type?: "text" | "textarea" | "number" | "select" | "multiselect" | "combobox"
    | "date" | "datetime" | "checkbox" | "switch" | "json" | "relation" | "unit";

  /** Placeholder text (edit mode) */
  placeholder?: string;

  /** Help text shown below the input (edit mode) */
  description?: string;

  /** Whether field is required (edit mode) */
  required?: boolean;

  /** Whether field is disabled (edit mode) */
  disabled?: boolean;

  /** Static options for select/multiselect/combobox */
  options?: { value: string; label: string }[];

  /** Dynamic options from database table */
  dynamicOptions?: {
    table: string;
    valueField: string;
    labelField: string;
    filter?: Record<string, unknown>;
    orderBy?: string;
  };

  /** Related entity configuration (for relation type fields and FK display) */
  relation?: {
    entity: string;
    displayField: string;
  };

  /** Default value for create mode */
  defaultValue?: unknown;

  /** Conditional visibility based on current form values */
  showWhen?: (values: Partial<T>) => boolean;

  /** Unit type for unit fields/formatting */
  unitType?: "volume" | "weight" | "temperature" | "gravity" | "retail_volume";

  /** Allow inline unit switching */
  allowUnitSwitch?: boolean;

  // -- Mode control --

  /**
   * Controls whether this field is editable.
   * - true (default): editable in both create and edit modes
   * - false: always display-only (e.g., computed fields, timestamps)
   * - "create-only": editable in create mode, display-only in edit mode
   */
  editable?: boolean | "create-only";

  // -- Quick create --

  /**
   * Quick-create component for relation fields. Renders a "+" button that
   * opens a popover/dialog to create a new related record inline.
   * After creation, calls `onCreated(newId)` to auto-select the new record.
   */
  quickCreate?: FC<{ onCreated: (id: string) => void }>;
}

/**
 * Unified section definition for the combined detail/edit view.
 * Each section can contain either unified fields or a custom component.
 */
export type UnifiedSectionDef<T = Record<string, unknown>> = {
  /** Section identifier */
  id: string;

  /** Section title */
  title: string;

  /** Unified fields for this section */
  fields?: UnifiedFieldDef<T>[];

  /**
   * Custom component for view mode (or both modes if editComponent is not set).
   * Receives { data, editing, form } props. When headerActions triggers an action,
   * the component receives it via `actionTrigger`.
   */
  component?: ComponentType<{
    data: T;
    editing?: boolean;
    form?: unknown; // UseFormReturn - typed as unknown to avoid import
    actionTrigger?: { action: string; seq: number } | null;
  }>;

  /**
   * Custom component for edit mode (overrides component when editing).
   * Use this when view and edit have fundamentally different UIs.
   */
  editComponent?: ComponentType<{
    data: T;
    editing?: boolean;
    form?: unknown;
    actionTrigger?: { action: string; seq: number } | null;
  }>;

  /** Whether this section is collapsible */
  collapsible?: boolean;

  /** Default collapsed state */
  defaultCollapsed?: boolean;

  /**
   * Optional component rendered next to the section title (e.g., action buttons).
   * Receives `onAction` callback to trigger actions in the section body component.
   * The body component receives the action string via `actionTrigger` prop.
   */
  headerActions?: ComponentType<{ data: T; onAction: (action: string) => void }>;

  /** Tab name if using tabbed layout */
  tab?: string;

  /** Hide this section when creating a new entity */
  hideOnCreate?: boolean;
}

// =============================================================================
// Value Display Types (for non-state enum fields)
// =============================================================================

/**
 * Configuration for displaying enum values (like category, type, etc.).
 * Mirrors stateDisplay pattern but for non-state fields.
 */
export type ValueDisplayConfig = {
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
// Kanban Board Types
// =============================================================================

export type KanbanCardField<T> = {
  field: keyof T & string;
  label: string;
  format?: "date" | "datetime" | "number";
}

export type KanbanConfig<T> = {
  /** Field for card title */
  titleField: keyof T & string;
  /** Optional field for card subtitle */
  subtitleField?: keyof T & string;
  /** Additional fields shown on card (keep to 2-3) */
  cardFields?: KanbanCardField<T>[];
  /** States to hide from board (e.g., terminal states) */
  excludeStates?: string[];
}

// =============================================================================
// State Machine Types
// =============================================================================

export type StateMachineConfig<T> = {
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

export type EntityActionDef<T> = {
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

  /** When to disable this action (returns tooltip reason when disabled) */
  disabledWhen?: (data: T) => string | false;

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

  /** Delete mode: 'hard' issues DELETE, 'soft' sets is_active=false. Only used when name='delete'. */
  deleteMode?: "hard" | "soft";
}

// =============================================================================
// Dialog Types
// =============================================================================

export type EntityDialogConfig<T> = {
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

export type EntityRelationDef = {
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

  /** Hide the "Add" button on relation tabs (e.g., when creation is handled by a dialog) */
  hideAdd?: boolean;

  /** Custom component to render instead of default table (for inline editors, etc.) */
  component?: ComponentType<{ parentId: string; data?: Record<string, unknown> }>;
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
 * Resolve the list/back route for an entity. Uses an explicit override when
 * provided, otherwise derives `/{domain}/{name}s` from the entity config.
 */
export function resolveEntityBasePath<T>(
  entity: EntityCoreInput<T>,
  override?: string,
): string {
  return override || `/${entity.domain}/${entity.name}s`;
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
  entity: EntityCoreInput<T>,
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
  entity: EntityCoreInput<T>,
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
  entity: EntityCoreInput<T>,
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
  entity: EntityCoreInput<T>,
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
  entity: EntityCoreInput<T>,
  field: string,
  value: string | null | undefined
): "default" | "success" | "warning" | "error" | "info" {
  if (!value) return "default";
  const display = getValueDisplay(entity, field, value);
  return display?.color || "default";
}
