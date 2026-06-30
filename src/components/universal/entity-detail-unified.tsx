"use client";

/**
 * EntityDetailUnified - Combined Detail/Edit View Component
 *
 * Replaces EntityDetail + EntityForm with a unified component that reads from
 * `sections` (UnifiedSectionDef) config.
 *
 * Supports:
 * - View mode: data display, header, tabs, relations, state transitions, actions
 *   (`type: "button"` actions render as visible header buttons, capped at
 *   MAX_HEADER_ACTION_BUTTONS; the rest live in the Actions dropdown).
 *   Actions with `confirm: true` are gated behind EntityActionConfirmDialog
 *   and actions with `transitionFields` behind EntityTransitionFieldsDialog
 *   (which collects field values merged into the same UPDATE as the status
 *   flip) before any dispatch (including the page-level `onAction`
 *   override). Raw "Move to {state}" items are suppressed for targets listed
 *   in stateMachine.requiresAction (the named action stands in for them) or
 *   routed through a matching confirm/transition-fields action.
 * - Edit mode: inline form editing with react-hook-form, Zod validation,
 *   optimistic locking, dirty form guard, keyboard shortcuts
 * - Field-level conditional visibility (UnifiedFieldDef.showWhen): evaluated
 *   in FieldGrid against live form values in edit/create mode and against the
 *   loaded record in view mode. On save, user-entered values of fields hidden
 *   at save time are nulled out (see nullHiddenDirtyFieldValues)
 * - Create mode: when id is undefined, starts in edit mode with INSERT on save
 *   (relation tabs are hidden — there is no parent record to relate to yet).
 *   Any pending prefill-store payload (src/contexts/prefill-store.ts) is
 *   consumed once on mount and merged under the page's explicit
 *   `defaultValues`, so Duplicate/"Brew again"/AI-chat flows pre-fill the
 *   form on every create route. After a successful create, entities listed
 *   in POST_CREATE_TAB land on a specific tab of the new record (e.g. orders
 *   open on Items so line entry is the obvious next step) instead of Details.
 * - Duplicate: entities that set EntityConfig.excludeOnDuplicate get a
 *   framework-synthesized "Duplicate" item in the detail Actions dropdown
 *   that routes the record's carry-over values (buildDuplicateDefaults)
 *   through the prefill store to the create route.
 * - Tab deep-linking: `?tab=` selects the initial detail tab (a section tab
 *   name or a relation name, e.g. ?tab=order_items); tab changes are
 *   reflected back into the URL via history.replaceState
 * - Section headerActions: optional component rendered next to section title
 *   (e.g., "Add Event" button on brew day timeline)
 *
 * Keyboard shortcuts:
 * - Backspace: go back (view mode only)
 * - E: toggle into edit mode (view mode only)
 * - Cmd/Ctrl+Enter: save (edit mode)
 * - Escape: cancel edit (edit mode, with dirty guard)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePermissions } from "@/contexts/permissions";
import { DOMAIN_WRITE_PERMISSIONS } from "@/lib/permissions";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { runTransitionSideEffects } from "@/services/transition-side-effects";
import { formatValue } from "@/lib/format";
import { entityKeys, revisionKeys } from "@/lib/query-keys";
import { parseUnknownError } from "@/lib/errors";
import { CACHE_DURATIONS } from "@/lib/constants";
import { useEntityRecord } from "@/hooks/use-entity-record";
import { usePrefillStore } from "@/contexts/prefill-store";
import { updateWithOptimisticLock } from "@/lib/optimistic-lock";
import { useSubmitShortcut } from "@/hooks/use-submit-shortcut";
import { useDynamicOptions } from "@/hooks/use-dynamic-options";
import { useQBOAutoSync } from "@/hooks/use-qbo-auto-sync";
import { toast } from "sonner";
import {
  type EntityConfig,
  type EntityActionDef,
  type EntityRelationDef,
  type UnifiedSectionDef,
  type UnifiedFieldDef,
  resolveEntityBasePath,
  getStateLabel,
} from "@/types/entity";
import { entityRegistry } from "@/entities";
import { EntityErrorBoundary } from "./entity-error-boundary";
import { UnifiedField } from "./unified-field";
import { EntityDeleteDialog } from "./entity-delete-dialog";
import { EntityActionConfirmDialog } from "./entity-action-confirm-dialog";
import { EntityTransitionFieldsDialog } from "./entity-transition-fields-dialog";
import { ConflictDialog, useConflictDialog } from "@/components/ui/conflict-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/universal/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { AnimatedActionMenuItem } from "@/components/universal/animated-action-menu-item";
import type { UseFormReturn } from "react-hook-form";
import { log } from "@/lib/client-logger";
import { unwrap } from "@/lib/supabase/query-helpers";

/**
 * Max number of `type: "button"` actions rendered as visible header buttons.
 * Any beyond this overflow into the Actions dropdown.
 */
const MAX_HEADER_ACTION_BUTTONS = 3;

/**
 * Entities that opt in to landing on a specific tab right after create,
 * keyed by EntityConfig.name. Values must be a valid tab value on the
 * detail page: a relation name (EntityRelationDef.name) or a section tab.
 *
 * Creation is two-phase for these entities (save the header, then add
 * child rows), so the post-create redirect deep-links straight to the
 * child-row tab — e.g. a new order opens on Items so line entry is the
 * obvious next step — instead of dropping the user on Details.
 *
 * Lives here rather than on EntityConfig because the redirect is a detail
 * of this component's create flow; promote it to a config field if more
 * entities opt in.
 */
const POST_CREATE_TAB: Record<string, string> = {
  order: "order_items",
};

/**
 * Build the route pushed after a successful create: the new record's detail
 * page, deep-linked to the entity's POST_CREATE_TAB when one is configured.
 * Exported for src/components/universal/__tests__/detail-tab-deep-link.test.ts.
 */
export function buildPostCreateRedirect(
  entityName: string,
  basePath: string,
  newId: string
): string {
  const tab = POST_CREATE_TAB[entityName];
  return tab ? `${basePath}/${newId}?tab=${tab}` : `${basePath}/${newId}`;
}

/**
 * Resolve the initial detail tab from a `?tab=` search param. Unknown or
 * missing values fall back to "details" so stale deep links never select an
 * empty pane (e.g. a relation tab that is hidden in create mode).
 * Exported for src/components/universal/__tests__/detail-tab-deep-link.test.ts.
 */
export function resolveInitialTab(
  requestedTab: string | null,
  validTabs: string[]
): string {
  return requestedTab && validTabs.includes(requestedTab)
    ? requestedTab
    : "details";
}

// =============================================================================
// Props
// =============================================================================

export type EntityDetailUnifiedProps<T = Record<string, unknown>> = {
  entity: EntityConfig<T>;
  id?: string; // undefined = create mode
  basePath?: string;
  backUrl?: string;
  showEdit?: boolean; // default true
  onAction?: (actionName: string, data: T) => boolean;
  defaultValues?: Partial<T>; // For create mode
  /** Field names that should be rendered as disabled (read-only) */
  disabledFields?: string[];
  /** Callback when any form field value changes. Use setFieldValue to update other fields. */
  onFieldChange?: (
    fieldName: string,
    value: unknown,
    form: UseFormReturn<Record<string, unknown>>,
  ) => void;
}

// =============================================================================
// Helper: Extract editable fields from sections
// =============================================================================

function getEditableFieldsFromSections<T>(
  sections: UnifiedSectionDef<T>[]
): UnifiedFieldDef<T>[] {
  return sections
    .flatMap((s) => s.fields ?? [])
    .filter((f) => f.type);
}

// =============================================================================
// Helper: Field-level conditional visibility (UnifiedFieldDef.showWhen)
// =============================================================================

/**
 * Evaluate a field's conditional visibility against a values snapshot —
 * live form values in edit/create mode, the loaded record in view mode.
 * Fields without `showWhen` are always visible.
 *
 * Exported for the entity-config test that asserts the framework honors
 * field-level showWhen (src/entities/__tests__/field-show-when.test.ts).
 */
export function isFieldVisible<T>(
  field: UnifiedFieldDef<T>,
  values: Partial<T>
): boolean {
  return !field.showWhen || field.showWhen(values);
}

/**
 * Null out USER-ENTERED values of fields whose `showWhen` evaluates false at
 * save time, so a value typed/picked before the field became hidden (e.g. a
 * keg-transaction state select filled in, then the transaction type changed
 * so the select disappeared) is never persisted. Mutates `values` in place.
 *
 * Only dirty fields are nulled. Programmatic values must survive even while
 * their field is hidden: keg-transaction derives from_state/to_state defaults
 * from the URL (transactions/new/page.tsx), and in edit mode the loaded
 * record's legitimate values back-fill the form — nulling those would corrupt
 * the keg_inventory view, which is calculated from stored from/to states.
 *
 * Visibility is evaluated against a pre-pass snapshot so nulling one field
 * cannot change another field's visibility check (order-independent).
 *
 * Exported for src/entities/__tests__/field-show-when.test.ts.
 */
export function nullHiddenDirtyFieldValues<T>(
  values: Record<string, unknown>,
  fields: UnifiedFieldDef<T>[],
  dirtyFields: Record<string, unknown>
): void {
  const snapshot = { ...values } as Partial<T>;
  for (const field of fields) {
    if (isFieldVisible(field, snapshot)) continue;
    if (dirtyFields[field.name]) {
      values[field.name] = null;
    }
  }
}

// =============================================================================
// View-mode section grouping
// =============================================================================

/** Discriminated union for grouped vs standalone sections in view mode. */
type SectionGroup<T> =
  | { type: "field-group"; sections: UnifiedSectionDef<T>[] }
  | { type: "standalone"; section: UnifiedSectionDef<T> };

/**
 * Groups consecutive field-based sections into a single "field-group" run.
 * Custom component sections (those with `component`) stay standalone so they
 * keep their own Card. In edit mode, every section is standalone to preserve
 * clear form boundaries.
 */
function groupSectionsForDisplay<T>(
  sections: UnifiedSectionDef<T>[],
  editing: boolean
): SectionGroup<T>[] {
  if (editing) {
    return sections.map((s) => ({ type: "standalone" as const, section: s }));
  }

  const isFieldBased = (s: UnifiedSectionDef<T>) =>
    !!s.fields && !s.component;

  const groups: SectionGroup<T>[] = [];
  let currentFieldRun: UnifiedSectionDef<T>[] = [];

  const flushFieldRun = () => {
    if (currentFieldRun.length > 1) {
      groups.push({ type: "field-group", sections: currentFieldRun });
    } else if (currentFieldRun.length === 1) {
      groups.push({ type: "standalone", section: currentFieldRun[0] });
    }
    currentFieldRun = [];
  };

  for (const section of sections) {
    if (isFieldBased(section)) {
      currentFieldRun.push(section);
    } else {
      flushFieldRun();
      groups.push({ type: "standalone", section });
    }
  }
  flushFieldRun();

  return groups;
}

// =============================================================================
// Helper: Build default values for form initialization
// =============================================================================

function buildDefaultValues<T>(
  sections: UnifiedSectionDef<T>[],
  defaultValues?: Partial<T>
): Record<string, unknown> {
  const initial: Record<string, unknown> = {};
  for (const section of sections) {
    if (!section.fields) continue;
    for (const field of section.fields) {
      if (!field.type) continue;
      if (field.defaultValue !== undefined) {
        initial[field.name] =
          typeof field.defaultValue === "function"
            ? (field.defaultValue as () => unknown)()
            : field.defaultValue;
      } else {
        switch (field.type) {
          case "switch":
          case "checkbox":
            initial[field.name] = false;
            break;
          case "number":
          case "unit":
          case "relation":
            initial[field.name] = null;
            break;
          default:
            initial[field.name] = "";
        }
      }
    }
  }
  if (defaultValues) {
    Object.assign(initial, defaultValues);
  }
  return initial;
}

// =============================================================================
// Helper: Build prefill values for the framework Duplicate action
// =============================================================================

/**
 * Fields the framework always strips when duplicating a record, regardless of
 * the entity's `excludeOnDuplicate` list: row identity, audit columns, and the
 * optimistic-lock version. The state-machine state field is excluded
 * separately in buildDuplicateDefaults (its name varies per entity).
 */
const DUPLICATE_BASE_EXCLUSIONS = [
  "id",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "version",
] as const;

/**
 * Build create-form prefill values for the framework Duplicate action
 * (EntityConfig.excludeOnDuplicate): the record's section-field values minus
 * DUPLICATE_BASE_EXCLUSIONS, the state-machine state field, and the entity's
 * own `excludeOnDuplicate` identity fields.
 *
 * Only fields that render inputs in create mode carry over (`type` set and
 * not `editable: false` — "create-only" fields qualify), so display-only and
 * computed view columns (e.g. customer order stats) never leak into the
 * INSERT payload. Null/undefined values are dropped so per-field
 * `defaultValue`s still apply on the create form.
 *
 * Exported for src/components/universal/__tests__/duplicate-defaults.test.ts.
 */
export function buildDuplicateDefaults<T>(
  entity: EntityConfig<T>,
  record: Record<string, unknown>
): Record<string, unknown> {
  const excluded = new Set<string>([
    ...DUPLICATE_BASE_EXCLUSIONS,
    ...(entity.stateMachine ? [entity.stateMachine.stateField] : []),
    ...(entity.excludeOnDuplicate ?? []),
  ]);
  const prefill: Record<string, unknown> = {};
  for (const section of entity.sections ?? []) {
    for (const field of section.fields ?? []) {
      if (!field.type || field.editable === false) continue;
      if (excluded.has(field.name)) continue;
      const value = record[field.name];
      if (value === undefined || value === null) continue;
      prefill[field.name] = value;
    }
  }
  return prefill;
}

// =============================================================================
// Helper: Reset form from loaded record data and store optimistic lock version
// =============================================================================

function resetFormFromRecord(
  form: UseFormReturn<Record<string, unknown>>,
  record: Record<string, unknown>,
  formDefaults: Record<string, unknown>,
  loadedVersionRef: React.MutableRefObject<number | null>
): void {
  form.reset({ ...formDefaults, ...record });
  if (typeof record.version === "number") {
    loadedVersionRef.current = record.version;
  }
}

// =============================================================================
// Hook: Fetch relation display values for FK fields
// =============================================================================

function useRelationDisplayValues<T>(
  fields: UnifiedFieldDef<T>[] | undefined,
  data: T | null
): Record<string, string> {
  const supabase = createClient();

  const relationQueries = useMemo(() => {
    if (!fields || !data) return [];
    return fields
      .filter((f) => f.relation && data[f.name as keyof T])
      .map((f) => {
        const relEntity = entityRegistry.get(f.relation!.entity);
        const table = relEntity?.table || `${f.relation!.entity}s`;
        return {
          field: f.name,
          table,
          displayField: f.relation!.displayField,
          id: data[f.name as keyof T] as string,
        };
      });
  }, [fields, data]);

  const { data: relationMap = {} } = useQuery({
    queryKey: entityKeys.relationDisplay(relationQueries),
    enabled: relationQueries.length > 0,
    staleTime: CACHE_DURATIONS.STATIC_DATA,
    queryFn: async () => {
      const results: Record<string, string> = {};
      await Promise.all(
        relationQueries.map(async (q) => {
          try {
            const { data: row } = await dynamicFrom(supabase, q.table)
              .select(q.displayField)
              .eq("id", q.id)
              .single();
            if (row) {
              results[q.field] = row[q.displayField] as string;
            }
          } catch {
            // Silently ignore lookup failures
          }
        })
      );
      return results;
    },
  });

  return relationMap;
}

// =============================================================================
// Main Component
// =============================================================================

export function EntityDetailUnified<T = Record<string, unknown>>({
  entity,
  id,
  basePath,
  backUrl,
  showEdit = true,
  onAction,
  defaultValues,
  disabledFields,
  onFieldChange,
}: EntityDetailUnifiedProps<T>) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const supabase = createClient();
  // Resolved route base for this entity (list page; detail/create nested
  // under it). Only inline-only entities (`basePath: null`) resolve to null,
  // and those never render as standalone pages — "/" is a defensive fallback.
  const path = resolveEntityBasePath(entity, basePath) ?? "/";

  const isCreateMode = !id;
  const { can } = usePermissions();
  const writePermission = entity.domain
    ? DOMAIN_WRITE_PERMISSIONS[entity.domain]
    : undefined;
  const hasWritePermission = writePermission ? can(writePermission) : true;
  const canEdit = showEdit && !!entity.formSchema && hasWritePermission;

  const fetchTable = entity.viewTable || entity.table;
  const sections = useMemo(() => {
    const all = entity.sections ?? [];
    return isCreateMode ? all.filter((s) => !s.hideOnCreate) : all;
  }, [entity, isCreateMode]);

  // ---------------------------------------------------------------------------
  // Edit state
  // ---------------------------------------------------------------------------
  const [editing, setEditing] = useState(isCreateMode);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loadedVersionRef = useRef<number | null>(null);
  const conflictDialog = useConflictDialog();
  const [deleteAction, setDeleteAction] = useState<EntityActionDef<T> | null>(null);
  // Action awaiting user confirmation (EntityActionDef.confirm) — see runAction
  const [confirmAction, setConfirmAction] = useState<EntityActionDef<T> | null>(null);
  // Action awaiting its pre-transition fields dialog
  // (EntityActionDef.transitionFields) — see runAction
  const [transitionFieldsAction, setTransitionFieldsAction] =
    useState<EntityActionDef<T> | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingDiscardRef = useRef<(() => void) | null>(null);

  const submitRef = useSubmitShortcut();
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const [formErrors, setFormErrors] = useState<{ field: string; message: string }[]>([]);

  /** Set form errors and focus the error summary panel. */
  const showFormErrors = useCallback(
    (errors: { field: string; message: string }[]) => {
      setFormErrors(errors);
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Fetch record (skip in create mode)
  // ---------------------------------------------------------------------------
  const { data, isLoading, error, refetch } = useEntityRecord(
    entity as EntityConfig<Record<string, unknown>>,
    id,
  ) as {
    data: T | undefined;
    isLoading: boolean;
    error: unknown;
    refetch: () => void;
  };

  // ---------------------------------------------------------------------------
  // react-hook-form setup
  // ---------------------------------------------------------------------------
  // Create-mode prefill: consume any pending prefill-store payload exactly
  // once on mount — set by the framework Duplicate action (see runAction
  // below), domain flows like "Brew again", or the AI chat panel. Pages that
  // drain the store themselves (e.g. batches/new, packaging/new) consume it
  // during their own render, before this child runs, so this is a no-op
  // there. Explicit `defaultValues` (including URL-param prefill merged by
  // EntityDetailPage) win over store prefill.
  const [storePrefill] = useState<Record<string, unknown> | null>(() =>
    isCreateMode ? usePrefillStore.getState().consume().prefillData : null
  );

  const formDefaults = useMemo(
    () =>
      buildDefaultValues(sections, {
        ...storePrefill,
        ...(defaultValues as Partial<T> | undefined),
      } as Partial<T>),
    [sections, defaultValues, storePrefill]
  );

  const form = useForm<Record<string, unknown>>({
    resolver: entity.formSchema ? zodResolver(entity.formSchema) : undefined,
    defaultValues: formDefaults,
  });

  // When data loads, reset form with record values + store version.
  // Always track latest data, but only reset the form when not editing
  // to prevent discarding the user's in-progress changes.
  const prevDataRef = useRef<T | null>(null);
  useEffect(() => {
    if (data) {
      prevDataRef.current = data;
      if (!editing) {
        resetFormFromRecord(form, data as Record<string, unknown>, formDefaults, loadedVersionRef);
      }
    }
  }, [data, form, formDefaults, editing]);

  // ---------------------------------------------------------------------------
  // onFieldChange subscription
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!onFieldChange || !editing) return;
    const subscription = form.watch((_, { name }) => {
      if (name) {
        onFieldChange(name, form.getValues(name), form);
      }
    });
    return () => subscription.unsubscribe();
  }, [onFieldChange, editing, form]);

  // ---------------------------------------------------------------------------
  // Dynamic options for fields with dynamicOptions or relation type
  // ---------------------------------------------------------------------------
  const dynamicFields = useMemo(
    () =>
      sections
        .flatMap((s) => s.fields ?? [])
        .filter((f) => f.dynamicOptions || (f.type === "relation" && f.relation)),
    [sections]
  );
  const { optionsMap } = useDynamicOptions(
    dynamicFields as { name: string; type?: string; dynamicOptions?: { table: string; valueField: string; labelField: string; filter?: Record<string, unknown>; orderBy?: string }; relation?: { entity: string; displayField: string } }[]
  );

  // ---------------------------------------------------------------------------
  // Shared cache invalidation helper
  // ---------------------------------------------------------------------------
  const { triggerSync } = useQBOAutoSync(entity.name);

  const invalidateEntityCaches = useCallback(
    (recordId: string) => {
      queryClient.invalidateQueries({ queryKey: entityKeys.detail(fetchTable, recordId) });
      queryClient.invalidateQueries({ queryKey: entityKeys.detail(entity.table, recordId) });
      queryClient.invalidateQueries({ queryKey: entityKeys.all(entity.table) });
      if (entity.viewTable) {
        queryClient.invalidateQueries({ queryKey: entityKeys.all(entity.viewTable) });
      }
      queryClient.invalidateQueries({ queryKey: revisionKeys.forEntity(entity.table, recordId) });
    },
    [queryClient, fetchTable, entity.table, entity.viewTable]
  );

  // ---------------------------------------------------------------------------
  // State transition mutation
  //
  // Mirrors the list-view pattern in entity-data-table.tsx
  // (handleSingleTransition): loading/success/error toasts plus a
  // `.eq(stateField, currentState)` guard on the UPDATE so a concurrent
  // state change matches 0 rows and surfaces as a conflict instead of
  // silently clobbering the other user's change.
  // ---------------------------------------------------------------------------
  const transitionMutation = useMutation({
    mutationFn: async ({
      toState,
      extraFields,
    }: {
      toState: string;
      /** Values collected by EntityTransitionFieldsDialog, written in the
       *  same UPDATE as the status flip (EntityActionDef.transitionFields) */
      extraFields?: Record<string, unknown>;
    }) => {
      if (!entity.stateMachine)
        throw new Error("No state machine configured");
      const stateField = entity.stateMachine.stateField;
      const currentState = (data as Record<string, unknown> | null)?.[
        stateField
      ] as string | undefined;
      if (!currentState)
        throw new Error("Current status unknown — refresh and try again");
      const { data: updated, error } = await dynamicFrom(supabase, entity.table)
        .update({ ...extraFields, [stateField]: toState })
        .eq("id", id)
        .eq(stateField, currentState)
        .select("id");
      if (error) throw error;
      // 0 rows affected = the guard didn't match: someone else changed the state
      if (!updated || updated.length === 0)
        throw new Error("Status changed by someone else — refresh and try again");
    },
    onMutate: () => ({ loadingId: toast.loading("Updating status...") }),
    onSuccess: (_data, { toState }) => {
      invalidateEntityCaches(id || "");
      triggerSync(id || "", toState);
      // Post-transition side effects (e.g. completing a batch also confirms
      // its planned ingredient consumption) — shared registry in
      // services/transition-side-effects.ts. Fire-and-forget: the status
      // update already succeeded, so only surface side-effect failures.
      if (id) {
        void runTransitionSideEffects(supabase, entity.table, [id], toState).then(
          ({ error: sideEffectError }) => {
            if (sideEffectError) toast.error(sideEffectError);
          }
        );
      }
      toast.success(`Status updated to ${getStateLabel(entity, toState)}`);
    },
    onError: (err) => {
      // parseUnknownError keeps the hand-written guard messages above verbatim
      // while translating DB-level failures (check constraints, RLS) to
      // friendly text (src/lib/errors.ts)
      toast.error(parseUnknownError(err).message);
      // Refetch so the UI reflects whichever state won the race
      invalidateEntityCaches(id || "");
    },
    onSettled: (_data, _err, _vars, context) => {
      if (context?.loadingId) toast.dismiss(context.loadingId);
    },
  });

  // ---------------------------------------------------------------------------
  // Header info
  // ---------------------------------------------------------------------------
  const header = useMemo(() => {
    if (!data || !entity.detailHeader) return null;
    const { title, subtitle, badge } = entity.detailHeader;
    return {
      title: data[title] as string,
      subtitle: subtitle ? (data[subtitle] as string) : undefined,
      badge: badge ? (data[badge] as string) : undefined,
    };
  }, [data, entity.detailHeader]);

  const stateInfo = useMemo(() => {
    if (!data || !entity.stateMachine) return null;
    const currentState = data[entity.stateMachine.stateField] as string;
    const display = entity.stateMachine.stateDisplay?.[currentState];
    return {
      currentState,
      label: display?.label || currentState,
      color: display?.color || "default",
      validTransitions: entity.stateMachine.transitions[currentState] || [],
    };
  }, [data, entity.stateMachine]);

  // Generic "Move to {state}" dropdown targets, minus those owned by a named
  // action (stateMachine.requiresAction) — for such targets the action's own
  // menu item stands in, so its interactive flow (onAction interception,
  // dialogs) always runs instead of a bare status UPDATE.
  const rawTransitions = useMemo(() => {
    if (!stateInfo) return [];
    const requires = entity.stateMachine?.requiresAction;
    if (!requires) return stateInfo.validTransitions;
    return stateInfo.validTransitions.filter((toState) => !requires[toState]);
  }, [stateInfo, entity.stateMachine]);

  // Group sections by tab
  const { tabs, defaultSections } = useMemo(() => {
    const tabMap = new Map<string, UnifiedSectionDef<T>[]>();
    const noTab: UnifiedSectionDef<T>[] = [];

    for (const section of sections) {
      if (section.tab) {
        let group = tabMap.get(section.tab);
        if (!group) {
          group = [];
          tabMap.set(section.tab, group);
        }
        group.push(section);
      } else {
        noTab.push(section);
      }
    }

    return {
      tabs: Array.from(tabMap.entries()),
      defaultSections: noTab,
    };
  }, [sections]);

  const relationTabs = useMemo(() => {
    // Hidden in create mode: with no parent id yet, relation queries and
    // "Add" links would carry an empty parentId and dead-end mid-task.
    if (isCreateMode || !entity.relations) return [];
    return entity.relations.filter(
      (rel) => rel.showInDetail && rel.detailTab && rel.type === "hasMany"
    );
  }, [entity.relations, isCreateMode]);

  const availableActions = useMemo(() => {
    if (!data || !entity.actions) return [];
    // Deliberately diverges from lib/entity-actions getApplicableActions:
    // when stateInfo is null, fromStates-gated actions stay visible here.
    return entity.actions.filter((action) => {
      if (action.showWhen && !action.showWhen(data)) return false;
      if (action.fromStates && stateInfo) {
        return action.fromStates.includes(stateInfo.currentState);
      }
      return true;
    });
  }, [data, entity.actions, stateInfo]);

  // Framework-synthesized Duplicate action (EntityConfig.excludeOnDuplicate).
  // Deliberately NOT declared in entity.actions: it is appended to the detail
  // dropdown here and dispatched by runAction, so list surfaces (row menu,
  // mobile cards) — which have no navigate-with-prefill plumbing — never
  // render a dead menu item for it. Requires write permission because it
  // leads straight into the create form.
  const duplicateAction = useMemo<EntityActionDef<T> | null>(() => {
    if (
      isCreateMode ||
      !entity.excludeOnDuplicate ||
      !entity.formSchema ||
      !hasWritePermission
    ) {
      return null;
    }
    return { name: "duplicate", label: "Duplicate", icon: "copy", type: "dropdown" };
  }, [isCreateMode, entity, hasWritePermission]);

  // Split actions by configured presentation: `type: "button"` actions render
  // as visible header buttons (capped at MAX_HEADER_ACTION_BUTTONS; overflow
  // falls back into the dropdown), everything else stays in the dropdown.
  // The synthesized Duplicate slots in just before Delete (destructive
  // actions stay last) or at the end of the menu.
  const { headerButtonActions, dropdownActions } = useMemo(() => {
    const buttons = availableActions
      .filter((a) => a.type === "button")
      .slice(0, MAX_HEADER_ACTION_BUTTONS);
    const dropdown = availableActions.filter((a) => !buttons.includes(a));
    if (duplicateAction) {
      const deleteIdx = dropdown.findIndex((a) => a.name === "delete");
      if (deleteIdx >= 0) dropdown.splice(deleteIdx, 0, duplicateAction);
      else dropdown.push(duplicateAction);
    }
    return { headerButtonActions: buttons, dropdownActions: dropdown };
  }, [availableActions, duplicateAction]);

  // ---------------------------------------------------------------------------
  // Edit mode: toggle in
  // ---------------------------------------------------------------------------
  const startEditing = useCallback(() => {
    if (!canEdit) return;
    if (data) {
      resetFormFromRecord(form, data as Record<string, unknown>, formDefaults, loadedVersionRef);
    }
    setFormErrors([]);
    setEditing(true);
  }, [canEdit, data, form, formDefaults]);

  // ---------------------------------------------------------------------------
  // Cancel handler with dirty guard
  // ---------------------------------------------------------------------------
  const handleCancel = useCallback(() => {
    if (form.formState.isDirty) {
      pendingDiscardRef.current = () => {
        if (isCreateMode) {
          router.push(backUrl || path);
        } else {
          form.reset();
          setEditing(false);
        }
      };
      setShowUnsavedDialog(true);
      return;
    }
    if (isCreateMode) {
      router.push(backUrl || path);
      return;
    }
    form.reset();
    setEditing(false);
  }, [form, isCreateMode, router, backUrl, path]);

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------
  const handleSave = useCallback(async () => {
    const isValid = await form.trigger();
    if (!isValid) {
      const errors = Object.entries(form.formState.errors)
        .filter(([, err]) => err?.message)
        .map(([field, err]) => ({ field, message: err!.message as string }));
      showFormErrors(errors);
      return;
    }

    const values = form.getValues();

    // Pre-process: convert empty strings to null for optional fields
    const editableFields = getEditableFieldsFromSections(sections);
    for (const field of editableFields) {
      const key = field.name as string;
      if (values[key] === "" && !field.required) {
        values[key] = null;
      }
    }

    // Field-level showWhen: drop user-entered values of fields hidden at
    // save time (entered, then hidden by a later change to the controlling
    // field). Runs after the ""→null pass so visibility predicates see the
    // same normalized values the zod schema will parse.
    nullHiddenDirtyFieldValues(
      values,
      editableFields,
      form.formState.dirtyFields as Record<string, unknown>
    );

    if (!entity.formSchema) return;
    const result = entity.formSchema.safeParse(values);
    if (!result.success) {
      const errors: { field: string; message: string }[] = [];
      for (const err of result.error.issues) {
        const fieldPath = err.path.join(".");
        form.setError(fieldPath, { message: err.message });
        errors.push({ field: fieldPath, message: err.message });
      }
      showFormErrors(errors);
      return;
    }

    // State-machine state fields must only change via the guarded transition
    // path (transitionMutation above), which validates the transition and runs
    // side effects — a plain form save does neither. The field is also locked
    // in the UI (see isFieldEditable in unified-field.tsx), but the stale form
    // value still flows through safeParse, and on tables without a version
    // column the un-guarded UPDATE branch below could silently revert a
    // concurrent transition. Strip it from non-create payloads entirely.
    if (!isCreateMode && entity.stateMachine) {
      delete (result.data as Record<string, unknown>)[
        entity.stateMachine.stateField
      ];
    }

    setIsSubmitting(true);
    const loadingId = toast.loading(isCreateMode ? "Creating..." : "Saving...");
    try {
      if (isCreateMode) {
        const newRow = await unwrap(
          dynamicFrom(supabase, entity.table)
            .insert(result.data)
            .select()
            .single()
        ) as unknown as Record<string, unknown>;
        setFormErrors([]);
        toast.success(`${entity.displayName} created successfully`);
        const newId = (newRow as Record<string, unknown>).id as string;
        invalidateEntityCaches(newId);
        // Opted-in entities (POST_CREATE_TAB) land on a specific tab of the
        // new record — e.g. orders open on Items for line entry.
        router.push(buildPostCreateRedirect(entity.name, path, newId));
      } else if (id) {
        if (loadedVersionRef.current !== null) {
          const lockResult = await updateWithOptimisticLock(
            supabase,
            entity.table,
            id,
            result.data as Record<string, unknown>,
            loadedVersionRef.current
          );

          if (!lockResult.success) {
            if (lockResult.conflicted) {
              conflictDialog.showConflict();
              setIsSubmitting(false);
              return;
            }
            throw new Error(lockResult.error);
          }
        } else {
          await unwrap(
            dynamicFrom(supabase, entity.table)
              .update(result.data)
              .eq("id", id)
              .select()
              .single()
          );
        }

        setFormErrors([]);
        toast.success(`${entity.displayName} updated successfully`);
        invalidateEntityCaches(id);
        setEditing(false);
      }
    } catch (err) {
      // Translate Postgres errors (constraint names, RLS, unique collisions)
      // to friendly messages via src/lib/errors.ts. Single-column unique
      // violations land on the offending form field when it's editable here
      // (e.g. a duplicate po_number highlights the PO Number input) instead
      // of only toasting.
      const parsed = parseUnknownError(err);
      const fieldOnForm = parsed.field &&
        editableFields.some((f) => (f.name as string) === parsed.field)
          ? parsed.field
          : undefined;
      if (fieldOnForm) {
        form.setError(fieldOnForm, { message: parsed.message });
        showFormErrors([{ field: fieldOnForm, message: parsed.message }]);
      } else {
        toast.error(parsed.message);
      }
      log.error("Form submission error:", JSON.stringify(err, null, 2));
    } finally {
      toast.dismiss(loadingId);
      setIsSubmitting(false);
    }
  }, [
    form,
    sections,
    entity,
    isCreateMode,
    id,
    supabase,
    invalidateEntityCaches,
    path,
    router,
    conflictDialog,
    showFormErrors,
  ]);

  // ---------------------------------------------------------------------------
  // Conflict dialog handlers
  // ---------------------------------------------------------------------------
  const handleConflictRefresh = useCallback(async () => {
    conflictDialog.setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: entityKeys.detail(entity.table, id || ""),
      });
      const { data: freshData } = await dynamicFrom(supabase, entity.table)
        .select("*")
        .eq("id", id)
        .single();
      if (freshData) {
        resetFormFromRecord(
          form,
          freshData as Record<string, unknown>,
          formDefaults,
          loadedVersionRef
        );
        toast.info("Data refreshed. Please re-apply your changes.");
      }
    } catch {
      toast.error("Failed to refresh data");
    } finally {
      conflictDialog.hideConflict();
    }
  }, [conflictDialog, queryClient, entity.table, id, supabase, form, formDefaults]);

  const handleConflictDiscard = useCallback(() => {
    conflictDialog.hideConflict();
    setEditing(false);
  }, [conflictDialog]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function isInputElement(el: Element | null): boolean {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select"
        || (el as HTMLElement).isContentEditable;
    }

    function confirmDirtyNavigation(onConfirm: () => void): boolean {
      if (editing && form.formState.isDirty) {
        pendingDiscardRef.current = onConfirm;
        setShowUnsavedDialog(true);
        return false;
      }
      return true;
    }

    function handleKeyDown(e: KeyboardEvent) {
      const inInput = isInputElement(document.activeElement);

      if (inInput) {
        if (editing && e.key === "Escape") {
          e.preventDefault();
          handleCancel();
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "Backspace":
          e.preventDefault();
          if (confirmDirtyNavigation(() => router.push(backUrl || path))) {
            router.push(backUrl || path);
          }
          break;

        case "Escape":
          if (editing) {
            e.preventDefault();
            handleCancel();
          }
          break;

        case "e":
        case "E":
          if (!editing) {
            e.preventDefault();
            startEditing();
          }
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editing, router, path, backUrl, handleCancel, startEditing, form.formState.isDirty]);

  // ---------------------------------------------------------------------------
  // Rendering guards
  // ---------------------------------------------------------------------------
  if (!isCreateMode) {
    if (error) {
      return (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-destructive">
            Failed to load {entity.displayName.toLowerCase()}
          </p>
          <Button onClick={() => refetch()}>Try Again</Button>
        </div>
      );
    }

    if (isLoading) {
      return <EntityDetailSkeleton />;
    }

    if (!data) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          {entity.displayName} not found
        </div>
      );
    }
  }

  const displayData = (data || ({} as T)) as T;

  // Dispatch an action's effect (page-level onAction override, then state
  // transition or custom handler). Only called once any confirm /
  // transition-fields gate has passed — use runAction for user-initiated
  // clicks. `extraFields` carries values collected by the transition-fields
  // dialog into the same UPDATE payload as the status flip.
  const executeAction = (
    action: EntityActionDef<T>,
    extraFields?: Record<string, unknown>
  ) => {
    if (onAction && onAction(action.name, displayData)) return;
    if (action.toState) {
      if (transitionMutation.isPending) return;
      transitionMutation.mutate({ toState: action.toState, extraFields });
    } else {
      action.handler?.(displayData);
    }
  };

  // Shared action dispatcher used by both visible header buttons and dropdown
  // items, so presentation differences never change behavior (delete dialog,
  // transition-fields/confirm gates, onAction override, state transition vs.
  // custom handler). The gates run BEFORE the onAction override so
  // page-intercepted actions (e.g. calculate_landed_cost) are covered too.
  const runAction = (action: EntityActionDef<T>) => {
    if (action.disabledWhen?.(displayData)) return;
    if (action.name === "delete" && action.deleteMode) {
      setDeleteAction(action);
      return;
    }
    // Framework Duplicate (EntityConfig.excludeOnDuplicate): stash the
    // record's carry-over field values in the prefill store and open the
    // create route, whose mount-time consume (storePrefill above) feeds them
    // into the form defaults. Like delete, this is framework-owned — it
    // bypasses the page-level onAction override. An entity-declared action
    // named "duplicate" with its own handler still takes the normal path.
    if (action.name === "duplicate" && !action.handler && entity.excludeOnDuplicate) {
      usePrefillStore
        .getState()
        .setPrefill(
          buildDuplicateDefaults(entity, displayData as Record<string, unknown>)
        );
      router.push(`${path}/new`);
      return;
    }
    // Transition-fields gate first: when an action declares both
    // `transitionFields` and `confirm`, the fields dialog stands in for the
    // plain confirm dialog (it is itself a confirmation step).
    if (action.transitionFields?.length) {
      setTransitionFieldsAction(action);
      return;
    }
    if (action.confirm) {
      setConfirmAction(action);
      return;
    }
    executeAction(action);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-medium">
              {isCreateMode
                ? `Create ${entity.displayName}`
                : header?.title || `${entity.displayName} ${id}`}
            </h1>
            {!isCreateMode && stateInfo && (
              <StatusBadge
                status={stateInfo.currentState}
                config={entity.stateMachine?.stateDisplay}
              />
            )}
          </div>
          {!isCreateMode && header?.subtitle && (
            <p className="text-sm text-muted-foreground">{header.subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {editing && !isCreateMode && (
            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isSubmitting}>
              Cancel
              <span aria-hidden="true"><Kbd>Esc</Kbd></span>
            </Button>
          )}

          {editing && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Saving..." : "Save"}
              <span aria-hidden="true"><Kbd>⌘↵</Kbd></span>
            </Button>
          )}

          {canEdit && !editing && !isCreateMode && (
            <Button variant="ghost" size="sm" onClick={startEditing}>
              <Pencil className="h-4 w-4" />
              Edit
              <span aria-hidden="true"><Kbd>E</Kbd></span>
            </Button>
          )}

          {/* Visible `type: "button"` actions (first gets primary styling
              unless the config sets an explicit variant) */}
          {!editing &&
            !isCreateMode &&
            headerButtonActions.map((action, index) => {
              const disabledReason = action.disabledWhen?.(displayData);
              return (
                <Button
                  key={action.name}
                  size="sm"
                  className="max-sm:h-9 max-sm:px-3"
                  variant={
                    action.variant ?? (index === 0 ? "default" : "outline")
                  }
                  disabled={!!disabledReason || transitionMutation.isPending}
                  title={disabledReason || undefined}
                  onClick={() => runAction(action)}
                >
                  {action.label}
                </Button>
              );
            })}

          {!editing &&
            !isCreateMode &&
            (dropdownActions.length > 0 || rawTransitions.length > 0) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    Actions
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {rawTransitions.length > 0 && (
                    <>
                      {rawTransitions.map((toState) => {
                        const display =
                          entity.stateMachine?.stateDisplay?.[toState];
                        // A confirm- or transition-fields-gated action
                        // targeting the same state stands in for the raw
                        // transition, so its dialog (and onAction
                        // interception) runs instead of a one-click bare
                        // UPDATE into e.g. a terminal state.
                        const confirmEquivalent = entity.actions?.find(
                          (a) =>
                            (a.confirm || a.transitionFields?.length) &&
                            a.toState === toState
                        );
                        return (
                          <DropdownMenuItem
                            key={toState}
                            onClick={() => {
                              if (confirmEquivalent) {
                                runAction(confirmEquivalent);
                                return;
                              }
                              if (transitionMutation.isPending) return;
                              transitionMutation.mutate({ toState });
                            }}
                          >
                            Move to {display?.label || toState}
                          </DropdownMenuItem>
                        );
                      })}
                      {dropdownActions.length > 0 && (
                        <DropdownMenuSeparator />
                      )}
                    </>
                  )}

                  {dropdownActions.map((action) => {
                    const disabledReason = action.disabledWhen?.(
                      displayData
                    );
                    return (
                      <AnimatedActionMenuItem
                        key={action.name}
                        icon={action.icon}
                        label={action.label}
                        variant={
                          action.variant === "destructive"
                            ? "destructive"
                            : undefined
                        }
                        disabled={!!disabledReason}
                        title={disabledReason || undefined}
                        onClick={() => runAction(action)}
                      />
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
        </div>
      </div>

      {/* Form error summary */}
      {formErrors.length > 0 && (
        <div
          ref={errorSummaryRef}
          role="alert"
          tabIndex={-1}
          className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive outline-none"
        >
          <p className="font-medium">
            Please fix {formErrors.length} {formErrors.length === 1 ? "error" : "errors"}:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {formErrors.map((err) => (
              <li key={err.field}>
                <a href={`#${err.field}`} className="underline hover:no-underline">
                  {err.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Content */}
      {tabs.length > 0 || relationTabs.length > 0 ? (
        <UnifiedTabsWithRelations
          tabs={tabs}
          relationTabs={relationTabs}
          defaultSections={defaultSections}
          data={displayData}
          entity={entity}
          parentId={id || ""}
          editing={editing}
          isCreateMode={isCreateMode}
          form={form}
          optionsMap={optionsMap}
          disabledFields={disabledFields}
        />
      ) : (
        <div className="space-y-4">
          <SectionGroupRenderer
            sections={defaultSections}
            data={displayData}
            entity={entity}
            editing={editing}
            isCreateMode={isCreateMode}
            form={form}
            optionsMap={optionsMap}
            disabledFields={disabledFields}
          />
        </div>
      )}

      {/* Hidden save button for Cmd+Enter shortcut */}
      {editing && (
        <button
          ref={submitRef}
          type="button"
          className="hidden"
          onClick={handleSave}
          aria-hidden="true"
        />
      )}

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes that will be lost. Are you sure you want to discard them?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              pendingDiscardRef.current = null;
            }}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = pendingDiscardRef.current;
                pendingDiscardRef.current = null;
                setShowUnsavedDialog(false);
                action?.();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Conflict Dialog */}
      <ConflictDialog
        open={conflictDialog.isOpen}
        onOpenChange={conflictDialog.setIsOpen}
        onRefresh={handleConflictRefresh}
        onDiscard={handleConflictDiscard}
        isRefreshing={conflictDialog.isRefreshing}
      />

      {/* Action Confirmation Dialog (EntityActionDef.confirm) */}
      {confirmAction && (
        <EntityActionConfirmDialog
          actionLabel={confirmAction.label}
          recordTitle={String(
            (displayData as Record<string, unknown>)[
              entity.detailHeader?.title ?? "name"
            ] ?? entity.displayName
          )}
          destructive={confirmAction.variant === "destructive"}
          open={!!confirmAction}
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null);
          }}
          onConfirm={() => {
            const action = confirmAction;
            setConfirmAction(null);
            executeAction(action);
          }}
        />
      )}

      {/* Pre-Transition Fields Dialog (EntityActionDef.transitionFields) —
          collected values ride in the same UPDATE as the status flip */}
      {transitionFieldsAction?.transitionFields && (
        <EntityTransitionFieldsDialog
          actionLabel={transitionFieldsAction.label}
          recordTitle={String(
            (displayData as Record<string, unknown>)[
              entity.detailHeader?.title ?? "name"
            ] ?? entity.displayName
          )}
          fields={transitionFieldsAction.transitionFields}
          record={displayData}
          open={!!transitionFieldsAction}
          onOpenChange={(open) => {
            if (!open) setTransitionFieldsAction(null);
          }}
          onSubmit={(values) => {
            const action = transitionFieldsAction;
            setTransitionFieldsAction(null);
            executeAction(action, values);
          }}
        />
      )}

      {/* Entity Delete Dialog */}
      {deleteAction?.deleteMode && (
        <EntityDeleteDialog
          entityTable={entity.table}
          entityDisplayName={entity.displayName}
          recordId={id!}
          recordTitle={String(
            (displayData as Record<string, unknown>)[
              entity.detailHeader?.title ?? "name"
            ] ?? entity.displayName
          )}
          deleteMode={deleteAction.deleteMode}
          open={!!deleteAction}
          onOpenChange={(open) => { if (!open) setDeleteAction(null); }}
          onSuccess={() => {
            setDeleteAction(null);
            queryClient.invalidateQueries({
              queryKey: entityKeys.all(entity.viewTable ?? entity.table),
            });
            queryClient.invalidateQueries({
              queryKey: entityKeys.all(entity.table),
            });
            // `path` already factors in the basePath prop, the entity
            // config's basePath, and the conventional derivation.
            router.push(backUrl ?? path);
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// Tabs with Relations
// =============================================================================

function UnifiedTabsWithRelations<T>({
  tabs,
  relationTabs,
  defaultSections,
  data,
  entity,
  parentId,
  editing,
  isCreateMode,
  form,
  optionsMap,
  disabledFields,
}: {
  tabs: [string, UnifiedSectionDef<T>[]][];
  relationTabs: EntityRelationDef[];
  defaultSections: UnifiedSectionDef<T>[];
  data: T;
  entity: EntityConfig<T>;
  parentId: string;
  editing: boolean;
  isCreateMode: boolean;
  form: UseFormReturn<Record<string, unknown>>;
  optionsMap: Record<string, { value: string; label: string }[]>;
  disabledFields?: string[];
}) {
  // Deep-linking: `?tab=` selects the initial tab (a section tab name or a
  // relation name, e.g. ?tab=order_items); unknown values fall back to
  // "details". Read once on mount — the post-create redirect lands on a new
  // route, so the param is picked up by the fresh mount there.
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState(() =>
    resolveInitialTab(searchParams.get("tab"), [
      ...tabs.map(([tabName]) => tabName),
      ...relationTabs.map((rel) => rel.name),
    ])
  );

  // Reflect tab changes back into the URL so the current tab survives
  // refresh/share. history.replaceState avoids a router navigation (Next.js
  // syncs useSearchParams from native history updates).
  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value);
    const url = new URL(window.location.href);
    if (value === "details") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", value);
    }
    window.history.replaceState(null, "", url);
  }, []);

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="details">Details</TabsTrigger>
        {tabs.map(([tabName]) => (
          <TabsTrigger key={tabName} value={tabName}>
            {tabName}
          </TabsTrigger>
        ))}
        {relationTabs.map((rel) => (
          <TabsTrigger key={rel.name} value={rel.name}>
            {rel.detailTab}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="details" className="space-y-4">
        <SectionGroupRenderer
          sections={defaultSections}
          data={data}
          entity={entity}
          editing={editing}
          isCreateMode={isCreateMode}
          form={form}
          optionsMap={optionsMap}
          disabledFields={disabledFields}
        />
      </TabsContent>

      {tabs.map(([tabName, tabSections]) => (
        <TabsContent key={tabName} value={tabName} className="space-y-4">
          <SectionGroupRenderer
            sections={tabSections}
            data={data}
            entity={entity}
            editing={editing}
            isCreateMode={isCreateMode}
            form={form}
            optionsMap={optionsMap}
            disabledFields={disabledFields}
          />
        </TabsContent>
      ))}

      {relationTabs.map((rel) => (
        <TabsContent key={rel.name} value={rel.name}>
          {rel.component ? (
            <rel.component
              parentId={parentId}
              data={data as Record<string, unknown>}
            />
          ) : (
            <RelationTable
              key={rel.name}
              relation={rel}
              parentId={parentId}
              enabled={activeTab === rel.name}
            />
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}

// =============================================================================
// Section Card (renders unified fields or custom component)
// =============================================================================

function UnifiedSectionCard<T>({
  section,
  data,
  entity,
  editing = false,
  isCreateMode = false,
  form,
  optionsMap = {},
  disabledFields,
}: {
  section: UnifiedSectionDef<T>;
  data: T;
  entity: EntityConfig<T>;
  editing?: boolean;
  isCreateMode?: boolean;
  form?: UseFormReturn<Record<string, unknown>>;
  optionsMap?: Record<string, { value: string; label: string }[]>;
  disabledFields?: string[];
}) {
  const relationDisplayValues = useRelationDisplayValues(section.fields, data);

  const HeaderActions = section.headerActions;
  const headerClassName = HeaderActions
    ? "flex flex-row items-center justify-between"
    : undefined;

  // Action trigger state for headerActions → component communication.
  // Uses a counter to ensure repeated clicks of the same action always trigger.
  const [actionTrigger, setActionTrigger] = useState<{ action: string; seq: number } | null>(null);
  const actionSeqRef = useRef(0);
  const fireAction = useCallback((action: string) => {
    actionSeqRef.current += 1;
    setActionTrigger({ action, seq: actionSeqRef.current });
  }, []);

  // Shared section header for all rendering paths
  const sectionHeader = (
    <CardHeader className={headerClassName}>
      <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{section.title}</CardTitle>
      {HeaderActions && <HeaderActions data={data} onAction={fireAction} />}
    </CardHeader>
  );

  // Custom component handling
  if (section.component) {
    const CustomComponent = section.component;

    if (section.collapsible && !editing) {
      return (
        <Collapsible defaultOpen={!section.defaultCollapsed}>
          <Card>
            <CardHeader>
              <CollapsibleTrigger className="flex items-center gap-2 group cursor-pointer w-full text-left">
                <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                <CardTitle className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{section.title}</CardTitle>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent>
                <CustomComponent data={data} editing={false} />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      );
    }

    return (
      <Card>
        {sectionHeader}
        <CardContent>
          <CustomComponent
            data={data}
            editing={editing}
            form={editing ? form : undefined}
            actionTrigger={actionTrigger}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {sectionHeader}
      <CardContent>
        <FieldGrid
          fields={section.fields}
          data={data}
          entity={entity}
          editing={editing}
          isCreateMode={isCreateMode}
          form={form}
          optionsMap={optionsMap}
          disabledFields={disabledFields}
          relationDisplayValues={relationDisplayValues}
        />
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Shared Field Grid - renders a list of UnifiedField items in a 12-col grid
// =============================================================================

type FieldGridProps<T> = {
  fields: UnifiedFieldDef<T>[] | undefined;
  data: T;
  entity: EntityConfig<T>;
  editing: boolean;
  isCreateMode: boolean;
  form?: UseFormReturn<Record<string, unknown>>;
  optionsMap?: Record<string, { value: string; label: string }[]>;
  disabledFields?: string[];
  relationDisplayValues: Record<string, string>;
};

/**
 * Renders a `dl` grid of UnifiedField elements. Shared across section
 * variants. Field-level `showWhen` is evaluated here: in edit/create mode
 * against live form values (LiveShowWhenFieldGrid subscribes via useWatch so
 * visibility reacts to in-form changes, e.g. keg-transaction state selects
 * appearing only for the types that need them); in view mode against the
 * loaded record. Hidden fields are not rendered at all.
 */
function FieldGrid<T>(props: FieldGridProps<T>) {
  const { fields, data, editing, form } = props;
  const hasConditionalFields = !!fields?.some((f) => f.showWhen);

  if (hasConditionalFields && editing && form) {
    return <LiveShowWhenFieldGrid {...props} form={form} />;
  }

  const visibleFields = hasConditionalFields
    ? fields?.filter((f) => isFieldVisible(f, data as Partial<T>))
    : fields;
  return <FieldGridDl {...props} fields={visibleFields} />;
}

/**
 * Edit/create-mode FieldGrid for sections containing `showWhen` fields.
 * Split out so the useWatch subscription (which re-renders on every form
 * value change) only exists when a section actually has conditional fields
 * and a form to watch.
 */
function LiveShowWhenFieldGrid<T>(
  props: FieldGridProps<T> & { form: UseFormReturn<Record<string, unknown>> }
) {
  const liveValues = useWatch({ control: props.form.control });
  const visibleFields = props.fields?.filter((f) =>
    isFieldVisible(f, liveValues as Partial<T>)
  );
  return <FieldGridDl {...props} fields={visibleFields} />;
}

/** Bare `dl` renderer shared by both FieldGrid variants (fields pre-filtered). */
function FieldGridDl<T>({
  fields,
  data,
  entity,
  editing,
  isCreateMode,
  form,
  optionsMap = {},
  disabledFields,
  relationDisplayValues,
}: FieldGridProps<T>) {
  return (
    <dl className="grid grid-cols-12 gap-4">
      {fields?.map((field) => {
        const effectiveField = disabledFields?.includes(field.name)
          ? { ...field, disabled: true }
          : field;
        return (
          <UnifiedField
            key={field.name}
            field={effectiveField as UnifiedFieldDef<Record<string, unknown>>}
            editing={editing}
            isCreateMode={isCreateMode}
            form={editing ? (form as UseFormReturn<Record<string, unknown>>) : undefined}
            record={data as Record<string, unknown>}
            entity={entity as EntityConfig<Record<string, unknown>>}
            relationDisplayValues={relationDisplayValues}
            dynamicOptions={optionsMap[field.name]}
          />
        );
      })}
    </dl>
  );
}

// =============================================================================
// Grouped Field Section Components (view mode only)
// =============================================================================

/** Common props shared by section rendering helpers. */
type SectionRenderProps<T> = {
  data: T;
  entity: EntityConfig<T>;
  editing: boolean;
  isCreateMode: boolean;
  form?: UseFormReturn<Record<string, unknown>>;
  optionsMap?: Record<string, { value: string; label: string }[]>;
  disabledFields?: string[];
}

/**
 * Renders grouped sections using `groupSectionsForDisplay`.
 * Replaces the direct `sections.map(s => <UnifiedSectionCard .../>)` pattern.
 */
function SectionGroupRenderer<T>(
  props: SectionRenderProps<T> & { sections: UnifiedSectionDef<T>[] }
) {
  const { sections, editing, ...rest } = props;
  const groups = useMemo(
    () => groupSectionsForDisplay(sections, editing),
    [sections, editing]
  );

  return (
    <>
      {groups.map((group) => {
        if (group.type === "field-group") {
          const key = group.sections.map((s) => s.id).join("+");
          return (
            <FieldSectionGroup
              key={key}
              sections={group.sections}
              editing={editing}
              {...rest}
            />
          );
        }
        return (
          <UnifiedSectionCard
            key={group.section.id}
            section={group.section}
            editing={editing}
            {...rest}
          />
        );
      })}
    </>
  );
}

/**
 * Renders multiple field-based sections inside a single Card with dividers.
 * Only used in view mode for groups of 2+ consecutive field sections.
 */
function FieldSectionGroup<T>({
  sections,
  data,
  entity,
  editing,
  isCreateMode,
  form,
  optionsMap = {},
  disabledFields,
}: SectionRenderProps<T> & { sections: UnifiedSectionDef<T>[] }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="space-y-4">
          {sections.map((section, idx) => (
            <InlineFieldSection
              key={section.id}
              section={section}
              data={data}
              entity={entity}
              editing={editing}
              isCreateMode={isCreateMode}
              form={form}
              optionsMap={optionsMap}
              disabledFields={disabledFields}
              showDivider={idx > 0}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Renders a single field section with a compact header (no Card wrapper).
 * Supports optional collapsible behavior via the section config.
 * Used inside FieldSectionGroup.
 */
function InlineFieldSection<T>({
  section,
  data,
  entity,
  editing,
  isCreateMode,
  form,
  optionsMap = {},
  disabledFields,
  showDivider,
}: SectionRenderProps<T> & {
  section: UnifiedSectionDef<T>;
  showDivider: boolean;
}) {
  const relationDisplayValues = useRelationDisplayValues(section.fields, data);

  const fieldGrid = (
    <FieldGrid
      fields={section.fields}
      data={data}
      entity={entity}
      editing={editing}
      isCreateMode={isCreateMode}
      form={form}
      optionsMap={optionsMap}
      disabledFields={disabledFields}
      relationDisplayValues={relationDisplayValues}
    />
  );

  if (section.collapsible) {
    return (
      <Collapsible defaultOpen={!section.defaultCollapsed}>
        <div>
          {showDivider && <Separator className="mb-6" />}
          <CollapsibleTrigger className="flex items-center gap-1.5 group cursor-pointer w-full text-left mb-3">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {section.title}
            </h3>
          </CollapsibleTrigger>
          <CollapsibleContent>{fieldGrid}</CollapsibleContent>
        </div>
      </Collapsible>
    );
  }

  return (
    <div>
      {showDivider && <Separator className="mb-6" />}
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
        {section.title}
      </h3>
      {fieldGrid}
    </div>
  );
}

// =============================================================================
// Relation Table (renders related entity records in a tabular format)
// =============================================================================

/**
 * Generic table for a hasMany relation tab. Routes are resolved through
 * `resolveEntityBasePath` (the shared resolver, same as detail pages and
 * breadcrumbs): the "Add" link points at `{base}/new?{foreignKey}={parentId}`
 * so the create form pre-fills the parent (see EntityDetailPage), and rows
 * navigate to `{base}/{id}`. When the related entity has no standalone routes
 * (`basePath: null`), the Add link is suppressed and rows are not clickable.
 */
function RelationTable({
  relation,
  parentId,
  enabled = true,
}: {
  relation: EntityRelationDef;
  parentId: string;
  enabled?: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const relatedEntity = entityRegistry.get(relation.entity);

  const {
    data: items,
    isLoading,
    error,
  } = useQuery({
    queryKey: entityKeys.related(
      relatedEntity?.table || relation.entity,
      relation.foreignKey,
      parentId
    ),
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
    enabled: enabled && !!relatedEntity && !!parentId,
    queryFn: async () => {
      if (!relatedEntity) return [];

      try {
        const joins = relatedEntity.listColumns
          .filter((col) => col.relation)
          .map((col) => {
            const relEntity = entityRegistry.get(col.relation!.entity);
            const tableName = relEntity?.table || `${col.relation!.entity}s`;
            const alias = col.accessorKey?.replace(/_id$/, "") || col.relation!.entity;
            return `${alias}:${tableName}!${col.accessorKey}(${col.relation!.displayField})`;
          });

        const selectClause = joins.length > 0
          ? `*, ${joins.join(", ")}`
          : "*";

        const sortField = relatedEntity.defaultSort?.column || "created_at";
        const sortAsc = relatedEntity.defaultSort?.direction === "asc";

        const data = await unwrap(
          dynamicFrom(supabase, relatedEntity.viewTable || relatedEntity.table)
            .select(selectClause)
            .eq(relation.foreignKey, parentId)
            .order(sortField, { ascending: sortAsc })
            .limit(50)
        ) as unknown as Record<string, unknown>[];
        return data || [];
      } catch (err) {
        log.error(
          `Failed to load ${relatedEntity.displayNamePlural}:`,
          err,
          JSON.stringify(err),
        );
        throw err;
      }
    },
  });

  if (!relatedEntity) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Related entity &quot;{relation.entity}&quot; not found
        </CardContent>
      </Card>
    );
  }

  const columns = relatedEntity.listColumns.filter(
    (col) => col.accessorKey && col.accessorKey !== relation.foreignKey
  );

  // Null when the related entity is inline-only (no standalone routes):
  // disables both the Add link and row navigation.
  const relatedBasePath = resolveEntityBasePath(relatedEntity);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{relation.detailTab}</CardTitle>
        {!relation.hideAdd && relatedBasePath && (
          <Button size="sm" variant="outline" asChild>
            <Link
              href={`${relatedBasePath}/new?${relation.foreignKey}=${parentId}`}
              aria-label={`Add new ${relatedEntity.displayName.toLowerCase()}`}
            >
              Add
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-center text-destructive py-8">
            Failed to load {relatedEntity.displayNamePlural.toLowerCase()}
          </p>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !items || items.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No {relatedEntity.displayNamePlural.toLowerCase()} yet
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col.accessorKey}>
                    {typeof col.header === "string"
                      ? col.header
                      : col.accessorKey}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: Record<string, unknown>) => {
                // Rows navigate to the related record's detail page —
                // mirrors handleRowClick in entity-data-table.tsx. Only
                // enabled when the target entity has a resolvable route.
                const rowHref = relatedBasePath
                  ? `${relatedBasePath}/${item.id}`
                  : null;
                return (
                <TableRow
                  key={item.id as string}
                  className={rowHref ? "cursor-pointer" : undefined}
                  tabIndex={rowHref ? 0 : undefined}
                  onClick={
                    rowHref
                      ? (e) => {
                          // Ignore clicks on interactive elements in cells
                          if ((e.target as HTMLElement).closest("a, button"))
                            return;
                          router.push(rowHref);
                        }
                      : undefined
                  }
                  onKeyDown={
                    rowHref
                      ? (e) => {
                          if (
                            e.key === "Enter" &&
                            e.target === e.currentTarget
                          ) {
                            e.preventDefault();
                            router.push(rowHref);
                          }
                        }
                      : undefined
                  }
                >
                  {columns.map((col, colIdx) => {
                    const key = col.accessorKey;
                    if (!key)
                      return (
                        <TableCell key={`empty-${colIdx}`}>
                          &mdash;
                        </TableCell>
                      );

                    let value = item[key];

                    if (col.relation) {
                      const alias = key.replace(/_id$/, "");
                      const relData = item[alias] as Record<
                        string,
                        unknown
                      > | null;
                      value =
                        relData?.[col.relation.displayField] ?? null;
                    }

                    return (
                      <TableCell key={key}>
                        {col.render
                          ? col.render(value, item as Record<string, unknown>)
                          : formatValue(value, col.format)}
                      </TableCell>
                    );
                  })}
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function EntityDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-12 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="col-span-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-5 w-32" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// Wrapped Export with Error Boundary
// =============================================================================

/**
 * EntityDetailUnified wrapped with error boundary for production resilience.
 */
export function EntityDetailUnifiedWithErrorBoundary<
  T = Record<string, unknown>,
>(props: EntityDetailUnifiedProps<T>) {
  return (
    <EntityErrorBoundary
      entity={props.entity as EntityConfig<Record<string, unknown>>}
    >
      <EntityDetailUnified {...props} />
    </EntityErrorBoundary>
  );
}
