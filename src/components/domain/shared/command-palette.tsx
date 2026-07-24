"use client";

/**
 * Command Palette
 *
 * Global cmd+K / ctrl+K palette with three capabilities:
 *
 * 1. Navigation — all navigation targets from the shared nav config
 *    (`nav-items.ts`, the same source the sidebar uses), grouped by sidebar
 *    section, plus Help and (permission-gated) Settings.
 * 2. Quick actions — permission-gated create/receive shortcuts ("New Batch",
 *    "New Order", "Receive PO") whose routes are derived from entity configs.
 * 3. Record search — once the query reaches MIN_SEARCH_CHARS, key entities
 *    (batches, recipes, orders, customers, purchase orders, inventory lots)
 *    are searched server-side with the same escaped-ilike `.or()` pattern the
 *    entity list pages use, and selecting a result navigates straight to the
 *    record's detail page.
 *
 * Entity metadata (table, searchable fields, display labels, routes) comes
 * from the client entity configs + `resolveEntityBasePath` — the same source
 * of truth detail pages and relation tables use — so palette routes cannot
 * diverge from real routes. Result visibility is gated per entity by the
 * corresponding `<resource>:read` permission.
 *
 * Mounted once in the authenticated app layout (`src/app/(app)/layout.tsx`)
 * so the keyboard shortcut is registered exactly once globally.
 *
 * Implementation note: shadcn's CommandDialog does not forward `shouldFilter`
 * to the underlying cmdk <Command>, so async record items embed the live
 * query in their cmdk `value`. They were already matched server-side, and the
 * embedded query guarantees they always pass cmdk's client-side filter.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePermissions } from "@/contexts/permissions";
import type { Permission } from "@/lib/permissions";
import { globalSearchKeys } from "@/lib/query-keys";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { escapePostgrestOrValue } from "@/components/data-table/adapter";
import { resolveEntityBasePath, type EntityConfig } from "@/types/entity";
import { batchEntity } from "@/entities/batch";
import { recipeEntity } from "@/entities/recipe";
import { orderEntity } from "@/entities/order";
import { customerEntity } from "@/entities/customer";
import { purchaseOrderEntity } from "@/entities/purchase-order";
import { inventoryLotEntity } from "@/entities/inventory-lot";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import {
  AnimatedBatches,
  AnimatedFileCheck,
  AnimatedFileStack,
  AnimatedFileText,
  AnimatedHelpCircle,
  AnimatedSettings,
  AnimatedShoppingCart,
  AnimatedUsers,
} from "@/components/icons/animated";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { navigation } from "@/components/domain/shared/nav-items";

// =============================================================================
// Record search configuration
// =============================================================================

/** Minimum (trimmed) query length before record search fires. */
export const MIN_SEARCH_CHARS = 3;

/** Max results fetched per searched entity. */
const RESULTS_PER_ENTITY = 5;

/** Debounce applied to the palette input before querying. */
const SEARCH_DEBOUNCE_MS = 200;

type AnyEntityConfig = EntityConfig<Record<string, unknown>>;
type IconComponent = ComponentType<{ className?: string }>;

type SearchEntityDescriptor = {
  entity: AnyEntityConfig;
  /** Read permission required to query + show results for this entity. */
  permission: Permission;
  icon: IconComponent;
}

/**
 * Entities searched by the palette, in display order. Each is gated by its
 * domain read permission (mirroring PERMISSION_MAP in src/lib/permissions.ts).
 * Validated structurally by command-palette.test.ts (searchable fields,
 * resolvable routes, title field present).
 */
export const SEARCH_ENTITIES: SearchEntityDescriptor[] = [
  { entity: batchEntity as unknown as AnyEntityConfig, permission: "batches:read", icon: AnimatedBatches },
  { entity: recipeEntity as unknown as AnyEntityConfig, permission: "recipes:read", icon: AnimatedFileText },
  { entity: orderEntity as unknown as AnyEntityConfig, permission: "orders:read", icon: AnimatedFileCheck },
  { entity: customerEntity as unknown as AnyEntityConfig, permission: "customers:read", icon: AnimatedUsers },
  { entity: purchaseOrderEntity as unknown as AnyEntityConfig, permission: "purchasing:read", icon: AnimatedShoppingCart },
  { entity: inventoryLotEntity as unknown as AnyEntityConfig, permission: "inventory:read", icon: AnimatedFileStack },
];

const SEARCH_ENTITY_ICONS = new Map<string, IconComponent>(
  SEARCH_ENTITIES.map((d) => [d.entity.name, d.icon]),
);

export type RecordSearchSpec = {
  /** Table/view to query — same choice the entity list page makes. */
  table: string;
  /** Column projection: id + detail-header title/subtitle. */
  select: string;
  /** Escaped PostgREST `.or()` ilike filter across the entity's searchableFields. */
  orFilter: string;
}

/**
 * Build the Supabase query parts for one entity's record search, using the
 * same escaped-ilike `.or()` pattern as entity-data-table's list search.
 * Returns null when the entity has no searchable fields. Exported for tests.
 */
export function buildRecordSearchSpec(
  entity: AnyEntityConfig,
  rawQuery: string,
): RecordSearchSpec | null {
  const fields = entity.searchableFields ?? [];
  if (fields.length === 0) return null;

  const escaped = escapePostgrestOrValue(rawQuery);
  const cols = new Set<string>(["id"]);
  if (entity.detailHeader?.title) cols.add(entity.detailHeader.title);
  if (entity.detailHeader?.subtitle) cols.add(entity.detailHeader.subtitle);

  return {
    table: entity.viewTable || entity.table,
    select: [...cols].join(","),
    orFilter: fields.map((field) => `${field}.ilike.%${escaped}%`).join(","),
  };
}

type RecordSearchResult = {
  entityName: string;
  /** Entity type label shown on the right of the row (e.g. "Batch"). */
  displayName: string;
  id: string;
  href: string;
  title: string;
  subtitle?: string;
}

/** Map a fetched row to a palette result using the entity's detailHeader. */
function toSearchResult(
  entity: AnyEntityConfig,
  basePath: string,
  row: Record<string, unknown>,
): RecordSearchResult {
  const id = String(row.id);
  const titleField = entity.detailHeader?.title;
  const subtitleField = entity.detailHeader?.subtitle;
  const title =
    titleField && row[titleField] != null && String(row[titleField]) !== ""
      ? String(row[titleField])
      : id;
  const subtitle =
    subtitleField && row[subtitleField] != null
      ? String(row[subtitleField])
      : undefined;
  return {
    entityName: entity.name,
    displayName: entity.displayName,
    id,
    href: `${basePath}/${id}`,
    title,
    subtitle,
  };
}

// =============================================================================
// Quick actions
// =============================================================================

type QuickAction = {
  label: string;
  href: string;
  permission: Permission;
  icon: IconComponent;
  /** Extra cmdk match terms beyond the label. */
  keywords: string;
}

/**
 * Static create/receive shortcuts. Routes are derived from entity configs via
 * resolveEntityBasePath so they track any future route changes. Exported for
 * tests.
 */
export const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "New Batch",
    href: `${resolveEntityBasePath(batchEntity)}/new`,
    permission: "batches:write",
    icon: AnimatedBatches,
    keywords: "create batch production",
  },
  {
    label: "New Order",
    href: `${resolveEntityBasePath(orderEntity)}/new`,
    permission: "orders:write",
    icon: AnimatedFileCheck,
    keywords: "create order sales",
  },
  {
    label: "Receive PO",
    href: `${resolveEntityBasePath(purchaseOrderEntity)}`,
    permission: "purchasing:write",
    icon: AnimatedShoppingCart,
    keywords: "receive purchase order purchasing",
  },
];

// =============================================================================
// Component
// =============================================================================

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const router = useRouter();
  const { can } = usePermissions();
  const supabase = useMemo(() => createClient(), []);

  const updateDebounced = useDebouncedCallback(setDebouncedQuery, SEARCH_DEBOUNCE_MS);

  // Clear the query so each palette session starts fresh (called on every
  // open/close transition: shortcut toggle, Escape/outside click, selection).
  const resetQuery = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) resetQuery();
    },
    [resetQuery]
  );

  // Register the global shortcut. Unlike useKeyboardShortcuts, this fires
  // even while an input is focused — the standard behavior for cmd+K.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
        resetQuery();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [resetQuery]);

  const navigate = useCallback(
    (href: string) => {
      handleOpenChange(false);
      router.push(href);
    },
    [handleOpenChange, router]
  );

  const allowedSearchEntities = useMemo(
    () => SEARCH_ENTITIES.filter((d) => can(d.permission)),
    [can]
  );

  const searchTerm = debouncedQuery.trim();
  // Gate on the live query too so a stale debounce firing after the dialog
  // closes can't leave a phantom search active on reopen.
  const searchActive =
    open &&
    query.trim().length >= MIN_SEARCH_CHARS &&
    searchTerm.length >= MIN_SEARCH_CHARS &&
    allowedSearchEntities.length > 0;

  const { data: results = [], isFetching } = useQuery({
    queryKey: globalSearchKeys.results(
      searchTerm,
      allowedSearchEntities.map((d) => d.entity.name)
    ),
    enabled: searchActive,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<RecordSearchResult[]> => {
      const perEntity = await Promise.all(
        allowedSearchEntities.map(async ({ entity }) => {
          const spec = buildRecordSearchSpec(entity, searchTerm);
          const basePath = resolveEntityBasePath(entity);
          if (!spec || !basePath) return [];
          const { data, error } = await dynamicFrom(supabase, spec.table)
            .select(spec.select)
            .or(spec.orFilter)
            .limit(RESULTS_PER_ENTITY);
          if (error) throw error;
          const rows = (data ?? []) as Record<string, unknown>[];
          return rows.map((row) => toSearchResult(entity, basePath, row));
        })
      );
      return perEntity.flat();
    },
  });

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Search"
      description="Search pages, actions, and records..."
    >
      <CommandInput
        placeholder="Search pages and records..."
        value={query}
        onValueChange={(value) => {
          setQuery(value);
          updateDebounced(value);
        }}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {searchActive && results.length > 0 && (
          <CommandGroup heading="Records">
            {results.map((result) => {
              const Icon = SEARCH_ENTITY_ICONS.get(result.entityName);
              return (
                <CommandItem
                  key={`${result.entityName}:${result.id}`}
                  // Prefix with the live query so these server-matched rows
                  // always pass cmdk's client-side filter (see module note).
                  value={`${query} ${result.displayName} ${result.title} ${result.id}`}
                  onSelect={() => navigate(result.href)}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                  <span className="truncate">{result.title}</span>
                  {result.subtitle && (
                    <span className="text-muted-foreground truncate">
                      {result.subtitle}
                    </span>
                  )}
                  <span className="text-muted-foreground ml-auto text-xs">
                    {result.displayName}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {searchActive && isFetching && results.length === 0 && (
          <div className="text-muted-foreground px-4 py-3 text-sm">
            Searching records…
          </div>
        )}
        {navigation.map((section) => (
          <CommandGroup key={section.label} heading={section.label}>
            {section.items.map((item) => (
              <CommandItem
                key={item.href}
                // Include the section label so e.g. "reports ttb" matches.
                value={`${section.label} ${item.label}`}
                onSelect={() => navigate(item.href)}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandGroup heading="Quick actions">
          {QUICK_ACTIONS.filter((action) => can(action.permission)).map(
            (action) => (
              <CommandItem
                key={action.label}
                value={`${action.label} ${action.keywords}`}
                onSelect={() => navigate(action.href)}
              >
                <action.icon className="h-4 w-4" />
                <span>{action.label}</span>
              </CommandItem>
            )
          )}
        </CommandGroup>
        <CommandGroup heading="General">
          <CommandItem value="Help" onSelect={() => navigate("/help")}>
            <AnimatedHelpCircle className="h-4 w-4" />
            <span>Help</span>
          </CommandItem>
          {can("settings:manage") && (
            <CommandItem value="Settings" onSelect={() => navigate("/settings")}>
              <AnimatedSettings className="h-4 w-4" />
              <span>Settings</span>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
