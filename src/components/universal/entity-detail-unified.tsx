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
 *
 * Keyboard shortcuts:
 * - Backspace: go back (view mode only)
 * - E: toggle into edit mode (view mode only)
 * - Cmd/Ctrl+Enter: save (edit mode)
 * - Escape: cancel edit (edit mode, with dirty guard)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePermissions } from "@/contexts/permissions";
import type { Permission } from "@/lib/permissions";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { createClient } from "@/lib/supabase/client";
import { formatValue } from "@/lib/utils";
import { entityKeys } from "@/lib/query-keys";
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
import { ChevronDown, Pencil } from "lucide-react";
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
// Domain-to-write-permission mapping (cosmetic gating only)
// =============================================================================

const DOMAIN_WRITE_PERMISSIONS: Record<string, Permission> = {
  production: "batches:write",
  inventory: "inventory:write",
  sales: "orders:write",
  purchasing: "purchasing:write",
  system: "settings:manage",
};

// =============================================================================
// Config Resolution - Legacy to Unified conversion
// =============================================================================

function getUnifiedSections<T>(
  entity: EntityConfig<T>
): UnifiedSectionDef<T>[] {
  if (entity.sections) return entity.sections;

  // Convert legacy detailSections to unified format
  return (entity.detailSections || []).map((section) => ({
    id: section.id,
    title: section.title,
    collapsible: section.collapsible,
    defaultCollapsed: section.defaultCollapsed,
    tab: section.tab,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: section.component as any, // Legacy components accept { data: T }
    fields: section.fields?.map((f) => ({
      name: f.field,
      label: f.label,
      format: f.format,
      unitType: f.unitType,
      relation: f.relation,
      render: f.render,
      fullWidth: f.fullWidth,
      editable: false as const, // Legacy fields are display-only in this context
    })),
  }));
}

// =============================================================================
// Helper: Extract editable fields from sections for useDynamicOptions
// =============================================================================

function getEditableFieldsFromSections<T>(
  sections: UnifiedSectionDef<T>[]
): UnifiedFieldDef<T>[] {
  const fields: UnifiedFieldDef<T>[] = [];
  for (const section of sections) {
    if (section.fields) {
      for (const field of section.fields) {
        // Only include fields that have a type (i.e., they are editable)
        if (field.type) {
          fields.push(field);
        }
      }
    }
  }
  return fields;
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
      if (!field.type) continue; // Skip display-only fields
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
// Hook: Fetch relation display values for FK fields
// =============================================================================

function useRelationDisplayValues<T>(
  fields: UnifiedFieldDef<T>[] | undefined,
  data: T | null
) {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Collect all relation fields that have a UUID value
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
            const { data: row } = await db
              .from(q.table)
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

  // Cast to any for dynamic table access - universal components work with any entity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Use viewTable if available (includes computed/joined fields), otherwise base table
  const fetchTable = entity.viewTable || entity.table;

  // Resolve sections (unified or legacy)
  const sections = useMemo(() => getUnifiedSections(entity), [entity]);

  // ---------------------------------------------------------------------------
  // Edit state
  // ---------------------------------------------------------------------------
  const [editing, setEditing] = useState(isCreateMode);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loadedVersionRef = useRef<number | null>(null);
  const conflictDialog = useConflictDialog();
  const [deleteAction, setDeleteAction] = useState<EntityActionDef<T> | null>(null);

  // Cmd+Enter save shortcut - the ref is attached to a hidden save button
  const submitRef = useSubmitShortcut();

  // ---------------------------------------------------------------------------
  // Fetch record (skip in create mode)
  // ---------------------------------------------------------------------------
  const { data, isLoading, error } = useQuery({
    queryKey: entityKeys.detail(fetchTable, id || ""),
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db
        .from(fetchTable)
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

  // When data loads (edit mode), reset form with record values + store version
  const prevDataRef = useRef<T | null>(null);
  useEffect(() => {
    if (data && data !== prevDataRef.current) {
      prevDataRef.current = data;
      const record = data as Record<string, unknown>;
      // Merge defaults with loaded data
      const merged = { ...formDefaults, ...record };
      form.reset(merged);
      if (typeof record.version === "number") {
        loadedVersionRef.current = record.version;
      }
    }
  }, [data, form, formDefaults]);

  // ---------------------------------------------------------------------------
  // onFieldChange subscription - notify parent when form fields change
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
  // Dynamic options for editable fields
  // ---------------------------------------------------------------------------
  const editableFields = useMemo(
    () => (editing ? getEditableFieldsFromSections(sections) : []),
    [editing, sections]
  );
  const { optionsMap } = useDynamicOptions(
    editableFields as { name: string; type?: string; dynamicOptions?: { table: string; valueField: string; labelField: string; filter?: Record<string, unknown>; orderBy?: string }; relation?: { entity: string; displayField: string } }[]
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
      const { error } = await db
        .from(entity.table)
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

  // Get current state info
  const stateInfo = useMemo(() => {
    if (!data || !entity.stateMachine) return null;
    const currentState = data[entity.stateMachine.stateField] as string;
    const display = entity.stateMachine.stateDisplay?.[currentState];
    const validTransitions =
      entity.stateMachine.transitions[currentState] || [];
    return {
      currentState,
      label: display?.label || currentState,
      color: display?.color || "default",
      validTransitions,
    };
  }, [data, entity.stateMachine]);

  // Group sections by tab
  const { tabs, defaultSections } = useMemo(() => {
    const tabMap = new Map<string, UnifiedSectionDef<T>[]>();
    const noTab: UnifiedSectionDef<T>[] = [];

    for (const section of sections) {
      if (section.tab) {
        const existing = tabMap.get(section.tab) || [];
        tabMap.set(section.tab, [...existing, section]);
      } else {
        noTab.push(section);
      }
    }

    return {
      tabs: Array.from(tabMap.entries()),
      defaultSections: noTab,
    };
  }, [sections]);

  // Get relations that should show as tabs
  const relationTabs = useMemo(() => {
    if (!entity.relations) return [];
    return entity.relations.filter(
      (rel) => rel.showInDetail && rel.detailTab && rel.type === "hasMany"
    );
  }, [entity.relations]);

  // Get available actions
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
      const record = data as Record<string, unknown>;
      form.reset({ ...formDefaults, ...record });
      if (typeof record.version === "number") {
        loadedVersionRef.current = record.version;
      }
    }
    setEditing(true);
  }, [canEdit, data, form, formDefaults]);

  // ---------------------------------------------------------------------------
  // Cancel handler with dirty guard
  // ---------------------------------------------------------------------------
  const handleCancel = useCallback(() => {
    if (form.formState.isDirty) {
      const confirmed = window.confirm(
        "You have unsaved changes. Discard?"
      );
      if (!confirmed) return;
    }
    if (isCreateMode) {
      // In create mode, go back to list
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
    // Trigger validation
    const isValid = await form.trigger();
    if (!isValid) return;

    const values = form.getValues();

    // Pre-process: convert empty strings to null for optional fields
    const editableFieldsList = getEditableFieldsFromSections(sections);
    for (const field of editableFieldsList) {
      const key = field.name as string;
      if (values[key] === "" && !field.required) {
        values[key] = null;
      }
    }

    // Validate with Zod
    if (!entity.formSchema) return;
    const result = entity.formSchema.safeParse(values);
    if (!result.success) {
      // Set errors on form
      for (const err of result.error.issues) {
        const fieldPath = err.path.join(".");
        form.setError(fieldPath, { message: err.message });
      }
      return;
    }

    setIsSubmitting(true);
    try {
      if (isCreateMode) {
        // INSERT
        const { data: newRow, error } = await db
          .from(entity.table)
          .insert(result.data)
          .select()
          .single();
        if (error) throw error;
        toast.success(`${entity.displayName} created successfully`);
        const newId = (newRow as Record<string, unknown>).id as string;
        invalidateEntityCaches(newId);
        router.push(`${path}/${newId}`);
      } else if (id) {
        // UPDATE
        if (loadedVersionRef.current !== null) {
          // Optimistic locking
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

          toast.success(`${entity.displayName} updated successfully`);
        } else {
          // Standard update (no version field)
          const { error } = await db
            .from(entity.table)
            .update(result.data)
            .eq("id", id)
            .select()
            .single();
          if (error) throw error;
          toast.success(`${entity.displayName} updated successfully`);
        }

        // Invalidate caches
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
    db,
    supabase,
    invalidateEntityCaches,
    path,
    router,
    conflictDialog,
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
      const { data: freshData } = await db
        .from(entity.table)
        .select("*")
        .eq("id", id)
        .single();
      if (freshData) {
        const record = freshData as Record<string, unknown>;
        form.reset({ ...formDefaults, ...record });
        if (typeof record.version === "number") {
          loadedVersionRef.current = record.version;
        }
        toast.info("Data refreshed. Please re-apply your changes.");
      }
    } catch {
      toast.error("Failed to refresh data");
    } finally {
      conflictDialog.hideConflict();
    }
  }, [conflictDialog, queryClient, entity.table, id, db, form, formDefaults]);

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

    function confirmDirtyNavigation(): boolean {
      if (editing && form.formState.isDirty) {
        return window.confirm("You have unsaved changes. Discard?");
      }
      return true;
    }

    function handleKeyDown(e: KeyboardEvent) {
      const inInput = isInputElement(document.activeElement);

      // Allow Escape from inputs during edit mode
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
          if (confirmDirtyNavigation()) {
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

  // In create mode, don't show loading/error for data fetch
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

  // For display purposes, use data or empty object for create mode
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
            <Kbd>⌫</Kbd>
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
          {editing && (
            <Button
              onClick={handleSave}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Saving..." : `Save ${entity.displayName}`}
              <Kbd>⌘↵</Kbd>
            </Button>
          )}

          {canEdit && !editing && !isCreateMode && (
            <Button variant="outline" onClick={startEditing}>
              <Pencil className="h-4 w-4" />
              Edit
              <Kbd>E</Kbd>
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
                  {/* State transitions */}
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

                  {/* Custom actions */}
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
          {defaultSections.map((section) => (
            <UnifiedSectionCard
              key={section.id}
              section={section}
              data={displayData}
              entity={entity}
              editing={editing}
              isCreateMode={isCreateMode}
              form={form}
              optionsMap={optionsMap}
              disabledFields={disabledFields}
            />
          ))}
        </div>
      )}

      {/* Hidden save button for Cmd+Enter shortcut */}
      {editing && (
        <button
          ref={submitRef}
          type="button"
          className="hidden"
          onClick={handleSave}
          aria-hidden
        />
      )}

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
        {defaultSections.map((section) => (
          <UnifiedSectionCard
            key={section.id}
            section={section}
            data={data}
            entity={entity}
            editing={editing}
            isCreateMode={isCreateMode}
            form={form}
            optionsMap={optionsMap}
            disabledFields={disabledFields}
          />
        ))}
      </TabsContent>

      {tabs.map(([tabName, tabSections]) => (
        <TabsContent key={tabName} value={tabName} className="space-y-4">
          {tabSections.map((section) => (
            <UnifiedSectionCard
              key={section.id}
              section={section}
              data={data}
              entity={entity}
              editing={editing}
              isCreateMode={isCreateMode}
              form={form}
              optionsMap={optionsMap}
              disabledFields={disabledFields}
            />
          ))}
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
  // Always call the relation hook (rules of hooks)
  const relationDisplayValues = useRelationDisplayValues(
    section.fields,
    data
  );

  // Custom component handling
  if (editing && section.editComponent) {
    const EditComponent = section.editComponent;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{section.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <EditComponent data={data} editing={true} form={form} />
        </CardContent>
      </Card>
    );
  }

  if (section.component) {
    const CustomComponent = section.component;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{section.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomComponent
            data={data}
            editing={editing}
            form={editing ? form : undefined}
          />
        </CardContent>
      </Card>
    );
  }

  // Render fields using UnifiedField
  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-12 gap-4">
          {section.fields?.map((field) => {
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
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Relation Table (identical to EntityDetail's RelationTable)
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fetch related records with pagination limit - only fetch when tab is active
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
    enabled: enabled && !!relatedEntity,
    queryFn: async () => {
      if (!relatedEntity) return [];

      try {
        // Build select with joins for FK display fields
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

        // Use entity's defaultSort or fallback to created_at
        const sortField = relatedEntity.defaultSort?.column || "created_at";
        const sortAsc = relatedEntity.defaultSort?.direction === "asc";

        // Use configured limit or default to 50
        const limit = relation.relationLimit || 50;

        const { data, error } = await db
          .from(relatedEntity.viewTable || relatedEntity.table)
          .select(selectClause)
          .eq(relation.foreignKey, parentId)
          .order(sortField, { ascending: sortAsc })
          .limit(limit);

        if (error) throw error;
        return data || [];
      } catch (err) {
        console.error(
          `Failed to load ${relatedEntity.displayNamePlural}:`,
          err
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

  // Convert snake_case entity name to kebab-case for URL routes
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

                    // Handle relation display - data comes back keyed by alias
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
