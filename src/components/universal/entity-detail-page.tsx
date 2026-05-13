"use client";

/**
 * EntityDetailPage
 *
 * Pairs `EntityBreadcrumb` with `EntityDetailUnifiedWithErrorBoundary` for the
 * common case where a detail/create route renders nothing but the entity body.
 * Pages that compose additional layout content (banners, sub-sections,
 * sibling cards) should render `<EntityBreadcrumb />` directly above their
 * custom layout instead.
 */

import { resolveEntityBasePath } from "@/types/entity";
import {
  EntityDetailUnifiedWithErrorBoundary,
  type EntityDetailUnifiedProps,
} from "./entity-detail-unified";
import { EntityBreadcrumb } from "./entity-breadcrumb";

export function EntityDetailPage<T extends Record<string, unknown>>(
  props: EntityDetailUnifiedProps<T>,
) {
  const { entity, basePath, id } = props;

  return (
    <div className="space-y-4">
      <EntityBreadcrumb
        entity={entity}
        basePath={resolveEntityBasePath(entity, basePath)}
        id={id}
        currentLabel={id ? undefined : "New"}
      />
      <EntityDetailUnifiedWithErrorBoundary {...props} />
    </div>
  );
}
