"use client";

/**
 * EntityDetailUnified - Combined Detail/Edit View Component
 *
 * Replaces EntityDetail + EntityForm with a unified component that reads from
 * `sections` (UnifiedSectionDef) config. Falls back to legacy `detailSections`
 * by converting them on the fly.
 *
 * Supports:
 * - View mode: data display, header, tabs, relations, state transitions, actions
 * - Edit mode: inline form editing with react-hook-form, Zod validation,
 *   optimistic locking, dirty form guard, keyboard shortcuts
 * - Create mode: when id is undefined, starts in edit mode with INSERT on save
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
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { formatValue } from "@/lib/utils";
import { entityKeys, revisionKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import { updateWithOptimisticLock } from "@/lib/optimistic-lock";
import { useSubmitShortcut } from "@/hooks/use-submit-shortcut";
import { useDynamicOptions } from "@/hooks/use-dynamic-options";
import { useQBOAutoSync } from "@/hooks/use-qbo-auto-sync";
import { toast } from "sonner";
import type {
  EntityConfig,
  EntityActionDef,
  EntityRelationDef,
  UnifiedSectionDef,
  UnifiedFieldDef,
} from "@/types/entity";
import { entityRegistry } from "@/entities";
import { EntityErrorBoundary } from "./entity-error-boundary";
import { UnifiedField } from "./unified-field";
import { EntityDeleteDialog } from "./entity-delete-dialog";
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

// =============================================================================
// Props
// =============================================================================

export interface EntityDetailUnifiedProps<T = Record<string, unknown>> {
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
// Config Resolution - Legacy to Unified conversion
// =============================================================================

function getUnifiedSections<T>(
  entity: EntityConfig<T>
): UnifiedSectionDef<T>[] {
  if (entity.sections) return entity.sections;

  return (entity.detailSections || []).map((section) => ({
    id: section.id,
    title: section.title,
    collapsible: section.collapsible,
    defaultCollapsed: section.defaultCollapsed,
    tab: section.tab,
    // Legacy sections use a narrower component type (just { data: T }) or string.
    // Cast to unified type — extra props (editing, form) will be passed but unused.
    component: section.component as UnifiedSectionDef<T>["component"],
    fields: section.fields?.map((f) => ({
      name: f.field,
      label: f.label,
      format: f.format,
      unitType: f.unitType,
      relation: f.relation,
      render: f.render,
      fullWidth: f.fullWidth,
      editable: false as const,
    })),
  }));
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
// View-mode section grouping
// =============================================================================

/** Discriminated union for grouped vs standalone sections in view mode. */
type SectionGroup<T> =
  | { type: "field-group"; sections: UnifiedSectionDef<T>[] }
  | { type: "standalone"; section: UnifiedSectionDef<T> };

/**
 * Groups consecutive field-based sections into a single "field-group" run.
 * Custom component sections (those with `component` or `editComponent`) stay
 * standalone so they keep their own Card. In edit mode, every section is
 * standalone to preserve clear form boundaries.
 */
function groupSectionsForDisplay<T>(
  sections: UnifiedSectionDef<T>[],
  editing: boolean
): SectionGroup<T>[] {
  if (editing) {
    return sections.map((s) => ({ type: "standalone" as const, section: s }));
  }

  const isFieldBased = (s: UnifiedSectionDef<T>) =>
    !!s.fields && !s.component && !s.editComponent;

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
  const path = basePath || `/${entity.domain}/${entity.name}s`;

  const isCreateMode = !id;
  const { can } = usePermissions();
  const writePermission = entity.domain
    ? DOMAIN_WRITE_PERMISSIONS[entity.domain]
    : undefined;
  const hasWritePermission = writePermission ? can(writePermission) : true;
  const canEdit = showEdit && !!entity.formSchema && hasWritePermission;

  const fetchTable = entity.viewTable || entity.table;
  const sections = useMemo(() => getUnifiedSections(entity), [entity]);

  // ---------------------------------------------------------------------------
  // Edit state
  // ---------------------------------------------------------------------------
  const [editing, setEditing] = useState(isCreateMode);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loadedVersionRef = useRef<number | null>(null);
  const conflictDialog = useConflictDialog();
  const [deleteAction, setDeleteAction] = useState<EntityActionDef<T> | null>(null);
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
  const { data, isLoading, error } = useQuery({
    queryKey: entityKeys.detail(fetchTable, id || ""),
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await dynamicFrom(supabase, fetchTable)
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as T;
    },
  });

  // ---------------------------------------------------------------------------
  // react-hook-form setup
  // ---------------------------------------------------------------------------
  const formDefaults = useMemo(
    () => buildDefaultValues(sections, defaultValues as Partial<T> | undefined),
    [sections, defaultValues]
  );

  const form = useForm<Record<string, unknown>>({
    resolver: entity.formSchema ? zodResolver(entity.formSchema) : undefined,
    defaultValues: formDefaults,
  });

  // When data loads, reset form with record values + store version
  const prevDataRef = useRef<T | null>(null);
  useEffect(() => {
    if (data && data !== prevDataRef.current) {
      prevDataRef.current = data;
      resetFormFromRecord(form, data as Record<string, unknown>, formDefaults, loadedVersionRef);
    }
  }, [data, form, formDefaults]);

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
  // ---------------------------------------------------------------------------
  const transitionMutation = useMutation({
    mutationFn: async ({ toState }: { toState: string }) => {
      if (!entity.stateMachine)
        throw new Error("No state machine configured");
      const stateField = entity.stateMachine.stateField;
      const { error } = await dynamicFrom(supabase, entity.table)
        .update({ [stateField]: toState })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, { toState }) => {
      invalidateEntityCaches(id || "");
      triggerSync(id || "", toState);
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
    if (!entity.relations) return [];
    return entity.relations.filter(
      (rel) => rel.showInDetail && rel.detailTab && rel.type === "hasMany"
    );
  }, [entity.relations]);

  const availableActions = useMemo(() => {
    if (!data || !entity.actions) return [];
    return entity.actions.filter((action) => {
      if (action.showWhen && !action.showWhen(data)) return false;
      if (action.fromStates && stateInfo) {
        return action.fromStates.includes(stateInfo.currentState);
      }
      return true;
    });
  }, [data, entity.actions, stateInfo]);

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
    for (const field of getEditableFieldsFromSections(sections)) {
      const key = field.name as string;
      if (values[key] === "" && !field.required) {
        values[key] = null;
      }
    }

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

    setIsSubmitting(true);
    try {
      if (isCreateMode) {
        const { data: newRow, error } = await dynamicFrom(supabase, entity.table)
          .insert(result.data)
          .select()
          .single();
        if (error) throw error;
        setFormErrors([]);
        toast.success(`${entity.displayName} created successfully`);
        const newId = (newRow as Record<string, unknown>).id as string;
        invalidateEntityCaches(newId);
        router.push(`${path}/${newId}`);
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
          const { error } = await dynamicFrom(supabase, entity.table)
            .update(result.data)
            .eq("id", id)
            .select()
            .single();
          if (error) throw error;
        }

        setFormErrors([]);
        toast.success(`${entity.displayName} updated successfully`);
        invalidateEntityCaches(id);
        setEditing(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      toast.error(message);
      console.error("Form submission error:", err);
    } finally {
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
        <div className="text-center py-8 text-destructive">
          Failed to load {entity.displayName.toLowerCase()}
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link
            href={backUrl || path}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            <span aria-hidden="true"><Kbd>⌫</Kbd></span>
            Back
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
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
            <p className="text-muted-foreground">{header.subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {editing && !isCreateMode && (
            <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
              Cancel
              <span aria-hidden="true"><Kbd>Esc</Kbd></span>
            </Button>
          )}

          {editing && (
            <Button
              onClick={handleSave}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Saving..." : `Save ${entity.displayName}`}
              <span aria-hidden="true"><Kbd>⌘↵</Kbd></span>
            </Button>
          )}

          {canEdit && !editing && !isCreateMode && (
            <Button variant="outline" onClick={startEditing}>
              <Pencil className="h-4 w-4" />
              Edit
              <span aria-hidden="true"><Kbd>E</Kbd></span>
            </Button>
          )}

          {!editing &&
            !isCreateMode &&
            (availableActions.length > 0 ||
              (stateInfo && stateInfo.validTransitions.length > 0)) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    Actions
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {stateInfo && stateInfo.validTransitions.length > 0 && (
                    <>
                      {stateInfo.validTransitions.map((toState) => {
                        const display =
                          entity.stateMachine?.stateDisplay?.[toState];
                        return (
                          <DropdownMenuItem
                            key={toState}
                            onClick={() =>
                              transitionMutation.mutate({ toState })
                            }
                          >
                            Move to {display?.label || toState}
                          </DropdownMenuItem>
                        );
                      })}
                      {availableActions.length > 0 && (
                        <DropdownMenuSeparator />
                      )}
                    </>
                  )}

                  {availableActions.map((action) => {
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
                        onClick={() => {
                          if (disabledReason) return;
                          if (action.name === "delete" && action.deleteMode) {
                            setDeleteAction(action);
                            return;
                          }
                          if (
                            onAction &&
                            onAction(action.name, displayData)
                          ) {
                            return;
                          }
                          if (action.toState) {
                            transitionMutation.mutate({
                              toState: action.toState,
                            });
                          } else {
                            action.handler?.(displayData);
                          }
                        }}
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
            const listPath = backUrl ?? basePath ?? `/${entity.domain}/${entity.table.replace(/_/g, "-")}`;
            router.push(listPath);
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
  const [activeTab, setActiveTab] = useState("details");

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
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
      <CardTitle>{section.title}</CardTitle>
      {HeaderActions && <HeaderActions data={data} onAction={fireAction} />}
    </CardHeader>
  );

  // Custom component handling
  if (editing && section.editComponent) {
    const EditComponent = section.editComponent;
    return (
      <Card>
        {sectionHeader}
        <CardContent>
          <EditComponent data={data} editing={true} form={form} actionTrigger={actionTrigger} />
        </CardContent>
      </Card>
    );
  }

  if (section.component) {
    const CustomComponent = section.component;

    if (section.collapsible && !editing) {
      return (
        <Collapsible defaultOpen={!section.defaultCollapsed}>
          <Card>
            <CardHeader>
              <CollapsibleTrigger className="flex items-center gap-2 group cursor-pointer w-full text-left">
                <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                <CardTitle>{section.title}</CardTitle>
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

/** Renders a `dl` grid of UnifiedField elements. Shared across section variants. */
function FieldGrid<T>({
  fields,
  data,
  entity,
  editing,
  isCreateMode,
  form,
  optionsMap = {},
  disabledFields,
  relationDisplayValues,
}: {
  fields: UnifiedFieldDef<T>[] | undefined;
  data: T;
  entity: EntityConfig<T>;
  editing: boolean;
  isCreateMode: boolean;
  form?: UseFormReturn<Record<string, unknown>>;
  optionsMap?: Record<string, { value: string; label: string }[]>;
  disabledFields?: string[];
  relationDisplayValues: Record<string, string>;
}) {
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
interface SectionRenderProps<T> {
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
      <CardContent className="pt-6">
        <div className="space-y-6">
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
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
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
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {section.title}
      </h3>
      {fieldGrid}
    </div>
  );
}

// =============================================================================
// Relation Table (renders related entity records in a tabular format)
// =============================================================================

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
        const limit = relation.relationLimit || 50;

        const { data, error } = await dynamicFrom(supabase, relatedEntity.viewTable || relatedEntity.table)
          .select(selectClause)
          .eq(relation.foreignKey, parentId)
          .order(sortField, { ascending: sortAsc })
          .limit(limit);

        if (error) throw error;
        return data || [];
      } catch (err) {
        console.error(
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

  const routeName = relatedEntity.name.replace(/_/g, "-");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{relation.detailTab}</CardTitle>
        {!relation.hideAdd && (
          <Button size="sm" variant="outline" asChild>
            <Link
              href={`/${relatedEntity.domain}/${routeName}s/new?${relation.foreignKey}=${parentId}`}
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
              {items.map((item: Record<string, unknown>) => (
                <TableRow key={item.id as string}>
                  {columns.map((col) => {
                    const key = col.accessorKey;
                    if (!key)
                      return (
                        <TableCell key={`empty-${Math.random()}`}>
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
              ))}
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
