"use client";

/**
 * EntityDetailUnified - Combined Detail/Edit View Component
 *
 * Replaces EntityDetail with a unified component that reads from `sections`
 * (UnifiedSectionDef) config. Falls back to legacy `detailSections` by
 * converting them on the fly.
 *
 * View mode (this task) works identically to the current EntityDetail:
 * - Data fetching from viewTable or table
 * - Header rendering (title, subtitle, badge, actions dropdown)
 * - Tab organization (default "Details" tab + custom tabs + relation tabs)
 * - Section rendering using UnifiedField for field-based sections
 * - Custom component rendering for component-based sections
 * - Relation tables on their own tabs
 * - State machine transitions in actions dropdown
 * - onAction callback for page-level custom action handling
 * - Keyboard shortcut Backspace to go back
 * - Error boundary wrapping
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { formatValue } from "@/lib/utils";
import { entityKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import type {
  EntityConfig,
  EntityRelationDef,
  UnifiedSectionDef,
  UnifiedFieldDef,
} from "@/types/entity";
import { entityRegistry } from "@/entities";
import { EntityErrorBoundary } from "./entity-error-boundary";
import { UnifiedField } from "./unified-field";
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
import { ChevronDown } from "lucide-react";
import { AnimatedActionMenuItem } from "@/components/universal/animated-action-menu-item";

// =============================================================================
// Props
// =============================================================================

export interface EntityDetailUnifiedProps<T = Record<string, unknown>> {
  entity: EntityConfig<T>;
  id?: string; // undefined = create mode (handled in Task 7)
  basePath?: string;
  backUrl?: string;
  showEdit?: boolean; // default true
  onAction?: (actionName: string, data: T) => boolean;
  defaultValues?: Partial<T>; // For create mode (Task 7)
}

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
// Hook: Fetch relation display values for FK fields
// =============================================================================

function useRelationDisplayValues<T>(
  fields: UnifiedFieldDef<T>[] | undefined,
  data: T
) {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Collect all relation fields that have a UUID value
  const relationQueries = useMemo(() => {
    if (!fields) return [];
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
    queryKey: [
      "relation-display",
      ...relationQueries.map((q) => `${q.table}:${q.id}`),
    ],
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
}: EntityDetailUnifiedProps<T>) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const supabase = createClient();
  const path = basePath || `/${entity.domain}/${entity.name}s`;

  // Cast to any for dynamic table access - universal components work with any entity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Use viewTable if available (includes computed/joined fields), otherwise base table
  const fetchTable = entity.viewTable || entity.table;

  // Resolve sections (unified or legacy)
  const sections = useMemo(() => getUnifiedSections(entity), [entity]);

  // Fetch record
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

  // State transition mutation
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
    onSuccess: () => {
      // Invalidate both the view table (if used) and base table to ensure cache is cleared
      queryClient.invalidateQueries({
        queryKey: entityKeys.detail(fetchTable, id || ""),
      });
      if (entity.viewTable) {
        queryClient.invalidateQueries({
          queryKey: entityKeys.detail(entity.table, id || ""),
        });
      }
      // Also invalidate list queries to update status badges
      queryClient.invalidateQueries({
        queryKey: entityKeys.all(entity.table),
      });
      if (entity.viewTable) {
        queryClient.invalidateQueries({
          queryKey: entityKeys.all(entity.viewTable),
        });
      }
    },
  });

  // Get header info
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

    sections.forEach((section) => {
      if (section.tab) {
        const existing = tabMap.get(section.tab) || [];
        tabMap.set(section.tab, [...existing, section]);
      } else {
        noTab.push(section);
      }
    });

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
  // Keyboard shortcuts: Backspace to go back
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Don't trigger when typing in an input
      const el = document.activeElement;
      if (el) {
        const tag = el.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        if ((el as HTMLElement).isContentEditable) return;
      }

      if (e.key === "Backspace") {
        e.preventDefault();
        router.push(backUrl || path);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [router, path, backUrl]);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link
            href={backUrl || path}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            &larr; Back
            <Kbd>&lArr;</Kbd>
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              {header?.title || `${entity.displayName} ${id}`}
            </h1>
            {stateInfo && (
              <StatusBadge
                status={stateInfo.currentState}
                config={entity.stateMachine?.stateDisplay}
              />
            )}
          </div>
          {header?.subtitle && (
            <p className="text-muted-foreground">{header.subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {showEdit && (
            <Button variant="outline" asChild>
              <Link href={`${path}/${id}/edit`}>
                Edit
                <Kbd>E</Kbd>
              </Link>
            </Button>
          )}

          {(availableActions.length > 0 ||
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
                    {availableActions.length > 0 && <DropdownMenuSeparator />}
                  </>
                )}

                {/* Custom actions */}
                {availableActions.map((action) => {
                  const disabledReason = action.disabledWhen?.(data);
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
                        if (onAction && onAction(action.name, data)) {
                          return;
                        }
                        if (action.toState) {
                          transitionMutation.mutate({
                            toState: action.toState,
                          });
                        } else {
                          action.handler?.(data);
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
          data={data}
          entity={entity}
          parentId={id || ""}
        />
      ) : (
        <div className="space-y-4">
          {defaultSections.map((section) => (
            <UnifiedSectionCard
              key={section.id}
              section={section}
              data={data}
              entity={entity}
            />
          ))}
        </div>
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
}: {
  tabs: [string, UnifiedSectionDef<T>[]][];
  relationTabs: EntityRelationDef[];
  defaultSections: UnifiedSectionDef<T>[];
  data: T;
  entity: EntityConfig<T>;
  parentId: string;
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
}: {
  section: UnifiedSectionDef<T>;
  data: T;
  entity: EntityConfig<T>;
}) {
  // Always call the relation hook (rules of hooks)
  const relationDisplayValues = useRelationDisplayValues(
    section.fields,
    data
  );

  // Custom component takes precedence
  if (section.component) {
    const CustomComponent = section.component;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{section.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomComponent data={data} editing={false} />
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
        <dl className="grid grid-cols-2 gap-4">
          {section.fields?.map((field) => (
            <UnifiedField
              key={field.name}
              field={field as UnifiedFieldDef<Record<string, unknown>>}
              editing={false}
              isCreateMode={false}
              record={data as Record<string, unknown>}
              entity={entity as EntityConfig<Record<string, unknown>>}
              relationDisplayValues={relationDisplayValues}
            />
          ))}
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
        // Build select with relations for display fields
        let selectClause = "*";
        const joins: string[] = [];

        relatedEntity.listColumns.forEach((col) => {
          if (col.relation) {
            const relEntity = entityRegistry.get(col.relation.entity);
            const tableName = relEntity?.table || `${col.relation.entity}s`;
            const alias =
              col.accessorKey?.replace(/_id$/, "") || col.relation.entity;
            joins.push(
              `${alias}:${tableName}!${col.accessorKey}(${col.relation.displayField})`
            );
          }
        });

        if (joins.length > 0) {
          selectClause = `*, ${joins.join(", ")}`;
        }

        // Use entity's defaultSort or fallback to created_at
        const sortField = relatedEntity.defaultSort?.column || "created_at";
        const sortAsc = relatedEntity.defaultSort?.direction === "asc";

        // Use configured limit or default to 50
        const limit = relation.relationLimit || 50;

        const { data, error } = await db
          .from(relatedEntity.table)
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
        <Button size="sm" variant="outline" asChild>
          <Link
            href={`/${relatedEntity.domain}/${routeName}s/new?${relation.foreignKey}=${parentId}`}
            aria-label={`Add new ${relatedEntity.displayName.toLowerCase()}`}
          >
            Add
          </Link>
        </Button>
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
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
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
