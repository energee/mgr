"use client";

/**
 * EntityDetail - Universal Detail View Component
 *
 * Renders a detail view for any entity based on its configuration.
 * Supports: sections, tabs, custom components, actions, state badges.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { EntityConfig, EntitySectionDef } from "@/types/entity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/universal/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, MoreHorizontal, Pencil } from "lucide-react";

interface EntityDetailProps<T = Record<string, unknown>> {
  /** Entity configuration */
  entity: EntityConfig<T>;
  /** Record ID */
  id: string;
  /** Base path for navigation */
  basePath?: string;
  /** Custom back URL */
  backUrl?: string;
  /** Show edit button */
  showEdit?: boolean;
}

export function EntityDetail<T = Record<string, unknown>>({
  entity,
  id,
  basePath,
  backUrl,
  showEdit = true,
}: EntityDetailProps<T>) {
  const queryClient = useQueryClient();
  const supabase = createClient();
  const path = basePath || `/${entity.domain}/${entity.name}s`;

  // Cast to any for dynamic table access - universal components work with any entity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fetch record
  const { data, isLoading, error } = useQuery({
    queryKey: [entity.table, id],
    queryFn: async () => {
      const { data, error } = await db
        .from(entity.table)
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
      if (!entity.stateMachine) throw new Error("No state machine configured");
      const stateField = entity.stateMachine.stateField;
      const { error } = await db
        .from(entity.table)
        .update({ [stateField]: toState })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [entity.table, id] });
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
    const validTransitions = entity.stateMachine.transitions[currentState] || [];
    return {
      currentState,
      label: display?.label || currentState,
      color: display?.color || "default",
      validTransitions,
    };
  }, [data, entity.stateMachine]);

  // Group sections by tab
  const { tabs, defaultSections } = useMemo(() => {
    const sections = entity.detailSections || [];
    const tabMap = new Map<string, EntitySectionDef<T>[]>();
    const noTab: EntitySectionDef<T>[] = [];

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
  }, [entity.detailSections]);

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

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        Failed to load {entity.displayName.toLowerCase()}
      </div>
    );
  }

  if (isLoading) {
    return <EntityDetailSkeleton entity={entity} />;
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
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href={backUrl || path}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Link>
            </Button>
          </div>
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
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Link>
            </Button>
          )}

          {(availableActions.length > 0 || (stateInfo && stateInfo.validTransitions.length > 0)) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  Actions
                  <MoreHorizontal className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* State transitions */}
                {stateInfo && stateInfo.validTransitions.length > 0 && (
                  <>
                    {stateInfo.validTransitions.map((toState) => {
                      const display = entity.stateMachine?.stateDisplay?.[toState];
                      return (
                        <DropdownMenuItem
                          key={toState}
                          onClick={() => transitionMutation.mutate({ toState })}
                        >
                          Move to {display?.label || toState}
                        </DropdownMenuItem>
                      );
                    })}
                    {availableActions.length > 0 && <DropdownMenuSeparator />}
                  </>
                )}

                {/* Custom actions */}
                {availableActions.map((action) => (
                  <DropdownMenuItem
                    key={action.name}
                    onClick={() => {
                      if (action.toState) {
                        transitionMutation.mutate({ toState: action.toState });
                      } else {
                        action.handler?.(data);
                      }
                    }}
                  >
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Content */}
      {tabs.length > 0 ? (
        <Tabs defaultValue={tabs[0]?.[0] || "details"}>
          <TabsList>
            {defaultSections.length > 0 && <TabsTrigger value="details">Details</TabsTrigger>}
            {tabs.map(([tabName]) => (
              <TabsTrigger key={tabName} value={tabName}>
                {tabName}
              </TabsTrigger>
            ))}
          </TabsList>

          {defaultSections.length > 0 && (
            <TabsContent value="details" className="space-y-4">
              {defaultSections.map((section) => (
                <SectionCard key={section.id} section={section} data={data} />
              ))}
            </TabsContent>
          )}

          {tabs.map(([tabName, sections]) => (
            <TabsContent key={tabName} value={tabName} className="space-y-4">
              {sections.map((section) => (
                <SectionCard key={section.id} section={section} data={data} />
              ))}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div className="space-y-4">
          {defaultSections.map((section) => (
            <SectionCard key={section.id} section={section} data={data} />
          ))}
        </div>
      )}
    </div>
  );
}

// Section card component
function SectionCard<T>({
  section,
  data,
}: {
  section: EntitySectionDef<T>;
  data: T;
}) {
  // Custom component takes precedence
  if (section.component) {
    const CustomComponent = section.component;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{section.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomComponent data={data} />
        </CardContent>
      </Card>
    );
  }

  // Render fields
  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4">
          {section.fields?.map((field) => {
            const value = data[field.field as keyof T];
            return (
              <div
                key={field.field}
                className={field.fullWidth ? "col-span-2" : ""}
              >
                <dt className="text-sm font-medium text-muted-foreground">
                  {field.label}
                </dt>
                <dd className="mt-1">
                  {field.render
                    ? field.render(value, data)
                    : formatFieldValue(value, field.format)}
                </dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}

// Format field value based on type
function formatFieldValue(
  value: unknown,
  format?: "date" | "datetime" | "currency" | "number" | "percentage" | "json"
): string {
  if (value === null || value === undefined) return "—";

  switch (format) {
    case "date":
      return new Date(value as string).toLocaleDateString();
    case "datetime":
      return new Date(value as string).toLocaleString();
    case "currency":
      return `$${(value as number).toFixed(2)}`;
    case "number":
      return (value as number).toLocaleString();
    case "percentage":
      return `${value}%`;
    case "json":
      return JSON.stringify(value, null, 2);
    default:
      if (typeof value === "boolean") return value ? "Yes" : "No";
      return String(value);
  }
}

// Loading skeleton
function EntityDetailSkeleton<T>({ entity }: { entity: EntityConfig<T> }) {
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
