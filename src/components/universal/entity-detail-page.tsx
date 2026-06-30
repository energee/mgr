"use client";

/**
 * EntityDetailPage
 *
 * Pairs `EntityBreadcrumb` with `EntityDetailUnifiedWithErrorBoundary` for the
 * common case where a detail/create route renders nothing but the entity body.
 * Pages that compose additional layout content (banners, sub-sections,
 * sibling cards) should render `<EntityBreadcrumb />` directly above their
 * custom layout instead.
 *
 * In create mode (no `id`), URL search params are merged into the form's
 * default values so deep links — most notably the relation-tab "Add" buttons,
 * which append `?{foreignKey}={parentId}` — pre-fill the new record (e.g.
 * `/sales/orders/new?customer_id=X` pre-selects the customer). Only params
 * whose keys match a section field name or a relation foreign key are
 * applied, and explicit `defaultValues` passed by the page win over URL
 * params.
 */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { resolveEntityBasePath, type EntityConfig } from "@/types/entity";
import {
  EntityDetailUnifiedWithErrorBoundary,
  type EntityDetailUnifiedProps,
} from "./entity-detail-unified";
import { EntityBreadcrumb } from "./entity-breadcrumb";

/**
 * Collect the form-relevant keys for an entity: section field names plus
 * relation foreign keys. Used to whitelist which URL search params may
 * pre-fill the create form (arbitrary params are ignored).
 */
function collectPrefillableKeys<T>(entity: EntityConfig<T>): Set<string> {
  const keys = new Set<string>();
  for (const section of entity.sections ?? []) {
    for (const field of section.fields ?? []) {
      keys.add(field.name);
    }
  }
  for (const relation of entity.relations ?? []) {
    keys.add(relation.foreignKey);
  }
  return keys;
}

export function EntityDetailPage<T extends Record<string, unknown>>(
  props: EntityDetailUnifiedProps<T>,
) {
  const { entity, basePath, id, defaultValues } = props;
  const searchParams = useSearchParams();
  const isCreateMode = !id;

  // Create-mode prefill: merge whitelisted URL params under the page's own
  // defaultValues (explicit page code always wins over URL state).
  const mergedDefaults = useMemo(() => {
    if (!isCreateMode) return defaultValues;

    const allowedKeys = collectPrefillableKeys(entity);
    const fromParams: Record<string, unknown> = {};
    for (const [key, value] of searchParams.entries()) {
      if (value && allowedKeys.has(key)) {
        fromParams[key] = value;
      }
    }
    if (Object.keys(fromParams).length === 0) return defaultValues;
    return { ...fromParams, ...defaultValues } as Partial<T>;
  }, [isCreateMode, entity, searchParams, defaultValues]);

  return (
    <div className="space-y-4">
      <EntityBreadcrumb
        entity={entity}
        // Entities rendered as standalone pages always resolve a route; "/"
        // is a defensive fallback for a misconfigured `basePath: null`.
        basePath={resolveEntityBasePath(entity, basePath) ?? "/"}
        id={id}
        currentLabel={id ? undefined : "New"}
      />
      <EntityDetailUnifiedWithErrorBoundary
        {...props}
        defaultValues={mergedDefaults}
      />
    </div>
  );
}
