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

  /** Domain this entity belongs to */
  domain: EntityDomain;

  /**
   * Explicit route base path for this entity's pages. The app router tree
   * under `src/app/(app)` is the source of truth: the list page lives at
   * `basePath`, detail pages at `${basePath}/${id}`, and the create page at
   * `${basePath}/new`.
   *
   * - Omit for conventional routes, derived as `/{domain}/{name-with-dashes}s`
   *   (e.g. customer → `/sales/customers`).
   * - Set a string when the routes don't follow the convention
   *   (e.g. purchase_order → `/purchasing/pos`).
   * - Set `null` for inline-only entities with no standalone pages
   *   (e.g. po_line_item). Relation tables then render non-navigable rows
   *   and suppress their "Add" link.
   *
   * Validated against the route tree by entity-configs.test.ts.
   */
  basePath?: string | null;

  /** Default sort configuration */
  defaultSort?: { column: keyof T & string; direction: "asc" | "desc" };

  /**
   * Server-safe mirror of the FK relation columns in `presentation.listColumns`
   * — `{ accessorKey, relation }` for each list column whose display value is
   * resolved from a related table (the `__rel_` loop in runListQuery). Lives in
   * core so a Server Component can reproduce the list prefetch without importing
   * the client presentation half (sitewide loading pattern). Populate only when
   * the entity has relation list columns AND its list page is server-prefetched;
   * the client path reads the columns directly from `listColumns` regardless.
   */
  listRelations?: {
    accessorKey: string;
    relation: { entity: string; displayField: string };
  }[];

  /**
   * Quick filter tabs above the toolbar (presets that set URL filters on
   * click). Pure data — lives in core (not presentation) so a server
   * component's list prefetch can apply the `isDefault` preset and produce
   * the same first-render query key as the client (sitewide loading pattern).
   */
  quickFilters?: QuickFilterDef[];

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

  /** Unified sections for combined detail/edit view. */
  sections?: UnifiedSectionDef<T>[];

  /** Kanban board config. Requires stateMachine. */
  kanbanConfig?: KanbanConfig<T>;

  /** Available actions for this entity */
  actions?: EntityActionDef<T>[];

  /**
   * Opt in to the framework-provided "Duplicate" action on the detail page.
   * When defined (even as an empty array), EntityDetailUnified appends a
   * Duplicate item to the detail Actions dropdown that navigates to the
   * entity's create route with the current record's editable field values
   * pre-filled via the prefill store (src/contexts/prefill-store.ts).
   *
   * List the entity-specific identity fields that must NOT carry over to the
   * copy (e.g. po_number, sku, lot_number). The framework additionally always
   * excludes row identity/audit fields (id, created_at, updated_at,
   * created_by, updated_by, version), the stateMachine.stateField, and any
   * field that doesn't render an input in create mode (no `type`, or
   * `editable: false`) — so only true identity/content fields need listing
   * here. Exclusions are explicit by design: do NOT derive them from
   * `editable: false` alone, since create-only fields are editable in create
   * mode on purpose. See buildDuplicateDefaults in entity-detail-unified.tsx.
   */
  excludeOnDuplicate?: (keyof T & string)[];

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
 * Wrap a stateful entity's formSchema so the state field only accepts values
 * that exist in its state machine (audit EA-9). Several cores author the
 * status field as a bare `z.string()`; without this guard any string passes
 * client/service validation and only the DB enum rejects it. The guard is
 * membership-only — WHICH machine state is allowed on create vs. edit is
 * enforced by the form layer (see clampCreateStateField / the edit-mode strip
 * in entity-detail-unified.tsx) and the 00143/00205 UPDATE triggers.
 *
 * Applied centrally in `resolveServerCore` so every formSchema consumer
 * (EntityDetailUnified, QuickCreateDialog, entityService.create/update, the
 * AI chat cores registry) inherits it without per-entity schema edits.
 * Schemas whose parse output omits the state field entirely (e.g. delivery)
 * are untouched — the DB default supplies the initial state there.
 */
function withStateFieldGuard<T>(
  formSchema: EntityCore<T>["formSchema"],
  stateMachine: StateMachineConfig<T>,
): EntityCore<T>["formSchema"] {
  const { stateField, states } = stateMachine;
  return formSchema.superRefine((values, ctx) => {
    const value = (values as Record<string, unknown>)[stateField];
    // Absent/null state is the base schema's concern (defaults, nullability).
    if (value === undefined || value === null) return;
    if (typeof value !== "string" || !states.includes(value)) {
      ctx.addIssue({
        code: "custom",
        path: [stateField],
        message: `Invalid ${stateField} "${String(value)}" — must be one of: ${states.join(", ")}`,
      });
    }
  });
}

/**
 * Apply the single `EntityCore` default that doesn't depend on the
 * presentation half (`displayNamePlural` → `${displayName}s`) and return a
 * complete `EntityCore<T>`. Server-safe: no React imports, no `listColumns`
 * dependency. Used by both `createEntityConfig` (the React path) and
 * `src/entities/cores.ts` (the server path that powers the AI chat route).
 *
 * Stateful entities additionally get their formSchema wrapped with
 * `withStateFieldGuard` so the state field rejects strings outside the state
 * machine (audit EA-9) on every validation path.
 *
 * `searchableFields` and `defaultSort` are intentionally left as the core
 * authored them. Both are optional on `EntityCore`; defaulting them here
 * would change behavior for join-row entities that lack a `name` column
 * (`order_item`, `po_line_item`, `session_line_item`). The presentation-side
 * defaults stay in `createEntityConfig` where `listColumns` is available.
 */
export function resolveServerCore<T>(core: EntityCoreInput<T>): EntityCore<T> {
  return {
    ...core,
    displayNamePlural: core.displayNamePlural ?? `${core.displayName}s`,
    formSchema: core.stateMachine
      ? withStateFieldGuard(core.formSchema, core.stateMachine)
      : core.formSchema,
  };
}

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
    ...resolveServerCore(core),
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

  /**
   * Override default sort when this tab is active. On a preset that is also
   * `isDefault`, this becomes the no-`?sort=` default for the whole list
   * (mirrored into the server prefetch) — it applies even after the user
   * switches filters away from the preset, until they sort explicitly.
   */
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
// Unified Detail/Edit Types
// =============================================================================

/**
 * Unified field definition for the combined detail/edit view.
 * Each field knows how to render in both display (view) and input (edit) mode,
 * merging what used to be separate view/edit field-definition types.
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
   * Custom component for this section (used in both view and edit modes).
   * Receives { data, editing, form } props. When headerActions triggers an action,
   * the component receives it via `actionTrigger`.
   */
  component?: ComponentType<{
    data: T;
    editing?: boolean;
    form?: unknown; // UseFormReturn - typed as unknown to avoid import
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

  /**
   * Per-target action requirement: { toState: actionName }. When a target
   * state is listed here, reaching it requires the named entity action
   * (EntityActionDef.name) so the action's interactive flow (page-level
   * `onAction` interception, dialogs, side effects) always runs. Generic UI
   * paths that would otherwise perform a bare status UPDATE to that state
   * are suppressed:
   * - the "Move to {state}" item in the detail Actions dropdown
   *   (entity-detail-unified.tsx) is hidden — the named action's own menu
   *   item stands in for it
   * - the bulk status bar option (bulk-status-action-bar.tsx) is disabled
   *   with a hint pointing at the named action, and the bulk apply path
   *   (entity-data-table.tsx handleBulkStatusChange) refuses the target
   *   as a backstop
   */
  requiresAction?: Record<string, string>;

  /** State display configuration */
  stateDisplay?: Record<
    string,
    { label: string; color: "default" | "success" | "warning" | "error" | "info" }
  >;

  /** Hooks for state transitions. `validate` runs before a transition to the
   *  target state and returns an error message to block it (or null to allow). */
  hooks?: {
    validate?: Record<string, (data: T) => Promise<string | null> | string | null>;
  };
}

// =============================================================================
// Action Types
// =============================================================================

/**
 * A field collected by the pre-transition dialog
 * (EntityActionDef.transitionFields, rendered by
 * EntityTransitionFieldsDialog). Deliberately narrower than EntityFieldDef:
 * only simple inputs that make sense in a small modal. Collected values are
 * merged into the same UPDATE payload as the status flip, so they must be
 * real columns on the entity's base table.
 */
export type TransitionFieldDef<T> = {
  /** Column on the entity's base table, included in the transition UPDATE */
  name: string;

  /** Input label */
  label: string;

  /** Input type ("relation" resolves options via the entity registry) */
  type: "date" | "text" | "select" | "relation";

  /** Static options for type "select" */
  options?: { value: string; label: string }[];

  /** Options fetched from an arbitrary table (same shape as UnifiedFieldDef.dynamicOptions) */
  dynamicOptions?: {
    table: string;
    valueField: string;
    labelField: string;
    filter?: Record<string, unknown>;
    orderBy?: string;
  };

  /** Registry lookup for type "relation" (same shape as UnifiedFieldDef.relation) */
  relation?: { entity: string; displayField: string };

  /** Block dialog submit until the field has a value */
  required?: boolean;

  /** Initial value derived from the record being transitioned (e.g. default
   *  scheduled_date to the order's requested_date) */
  defaultValue?: (data: T) => unknown;
}

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

  /**
   * Confirm before executing. Honored by every action surface — detail
   * header buttons and Actions dropdown (entity-detail-unified.tsx runAction,
   * gated before the page-level `onAction` override), the list row menu
   * (data-table/adapter.tsx buildActionsColumn) and the mobile card menu
   * (entity-mobile-card-list.tsx) — via the shared
   * EntityActionConfirmDialog. Raw "Move to {state}" items whose target
   * matches a confirm action's `toState` are routed through that action so
   * they get the same gate.
   */
  confirm?: boolean;

  /**
   * Fields collected in a small pre-transition dialog
   * (EntityTransitionFieldsDialog) and merged into the same UPDATE payload
   * as the status flip, so a transition never lands without the data that
   * gives it meaning (e.g. orders.schedule collects scheduled_date,
   * pick_lists.assign collects assigned_to). Only meaningful with `toState`.
   *
   * Honored by every transition surface: the detail page gates the action
   * in runAction (entity-detail-unified.tsx), and the list view routes bare
   * transitions (row menu, kanban drag, mobile card menu) through the
   * dialog via getTransitionFieldsAction (entity-data-table.tsx
   * requestTransition). When set together with `confirm`, the fields dialog
   * replaces the plain confirm dialog — it is itself a confirmation step.
   *
   * Pair with stateMachine.requiresAction for the target state so bulk
   * status updates (which can't collect per-record fields) are suppressed
   * with a hint instead of bare-flipping.
   */
  transitionFields?: TransitionFieldDef<T>[];

  /** Handler function */
  handler?: (data: T) => Promise<void> | void;

  /** Delete mode: 'hard' issues DELETE, 'soft' sets is_active=false. Only used when name='delete'. */
  deleteMode?: "hard" | "soft";
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
 * Resolve the route base path for an entity's pages (list at the returned
 * path, detail at `{path}/{id}`, create at `{path}/new`). This is the single
 * source of truth for entity URL derivation — shared by detail pages,
 * breadcrumbs, and relation-table links so they can never diverge.
 *
 * Resolution order: explicit `override` (page-level prop) → the entity
 * config's `basePath` → the conventional `/{domain}/{name-with-dashes}s`
 * derivation. Returns `null` when the entity opts out of standalone routes
 * via `basePath: null` (inline-only entities).
 */
export function resolveEntityBasePath<T>(
  entity: EntityCoreInput<T>,
  override?: string,
): string | null {
  if (override) return override;
  if (entity.basePath !== undefined) return entity.basePath;
  return `/${entity.domain}/${entity.name.replace(/_/g, "-")}s`;
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
 * Select options a state-machine state field may offer in CREATE mode: only
 * the machine's initial state (audit EA-1). New records must enter their
 * lifecycle at `initialState` — creating a record directly in a later state
 * would bypass both server-side transition validation (the 00143/00205
 * triggers fire on UPDATE only, never INSERT) and the transition side-effect
 * registry (`transition_entity_atomic`, migration 00256), e.g. a packaging
 * session created as "Completed" would never deplete materials or create
 * finished goods. Consumed by the universal form layer (unified-field.tsx,
 * quick-create-dialog.tsx); authored option labels win when provided,
 * falling back to stateDisplay / formatted labels.
 */
export function createModeStateOptions<T>(
  stateMachine: StateMachineConfig<T>,
  authoredOptions?: { value: string; label: string }[],
): { value: string; label: string }[] {
  const { initialState } = stateMachine;
  const authored = authoredOptions?.find((o) => o.value === initialState);
  return [
    authored ?? {
      value: initialState,
      label:
        stateMachine.stateDisplay?.[initialState]?.label ||
        formatStateLabel(initialState),
    },
  ];
}

/**
 * Force a create-mode INSERT payload's state field to the state machine's
 * initial state (audit EA-1). New records must enter their lifecycle at
 * `initialState`: an INSERT is invisible to the server-side transition
 * triggers (migrations 00143/00205 fire on UPDATE only) and to the
 * transition side-effect registry (`transition_entity_atomic`, migration 00256),
 * so a record created directly in a later state (e.g. a packaging session
 * created "Completed") would skip material depletion, FG creation, and every
 * other transition effect. Create forms only offer the initial state
 * (createModeStateOptions) — this clamp is the backstop for values staged
 * via the prefill store or programmatic defaultValues. Payloads whose parsed
 * schema omits the state field (e.g. delivery) are untouched; the DB default
 * supplies the initial state there. No-op for stateless entities.
 *
 * Mutates `data` in place. Used by the create paths in
 * entity-detail-unified.tsx and quick-create-dialog.tsx.
 */
export function clampCreateStateField<T>(
  stateMachine: StateMachineConfig<T> | undefined,
  data: Record<string, unknown>,
): void {
  if (!stateMachine) return;
  const { stateField, initialState } = stateMachine;
  if (stateField in data) {
    data[stateField] = initialState;
  }
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
 * Find the entity action whose `transitionFields` dialog must collect data
 * before transitioning to `toState`. Used by generic transition surfaces
 * (kanban drag, mobile card menu, list row menu — see entity-data-table.tsx
 * requestTransition) to route what would otherwise be a bare status UPDATE
 * through the pre-transition dialog.
 */
export function getTransitionFieldsAction<T>(
  entity: EntityConfig<T>,
  toState: string
): EntityActionDef<T> | undefined {
  return entity.actions?.find(
    (a) => a.toState === toState && !!a.transitionFields?.length
  );
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
