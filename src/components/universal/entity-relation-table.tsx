"use client";

/**
 * EntityRelationTable - generic table for a hasMany relation tab.
 *
 * Extracted verbatim from entity-detail-unified.tsx (B10 mono-file split);
 * behavior is unchanged. Rendered by UnifiedTabsWithRelations for each
 * relation tab on a detail page.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { formatValue } from "@/lib/format";
import { entityKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import { entityRegistry } from "@/entities";
import { resolveEntityBasePath, type EntityRelationDef } from "@/types/entity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { unwrap } from "@/lib/supabase/query-helpers";
import { log } from "@/lib/client-logger";

/**
 * Generic table for a hasMany relation tab. Routes are resolved through
 * `resolveEntityBasePath` (the shared resolver, same as detail pages and
 * breadcrumbs): the "Add" link points at `{base}/new?{foreignKey}={parentId}`
 * so the create form pre-fills the parent (see EntityDetailPage), and rows
 * navigate to `{base}/{id}`. When the related entity has no standalone routes
 * (`basePath: null`), the Add link is suppressed and rows are not clickable.
 */
export function RelationTable({
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
