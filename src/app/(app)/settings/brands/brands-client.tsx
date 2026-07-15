"use client";

/**
 * Brands List (client)
 *
 * The interactive brands list, split out from page.tsx so the route can be a
 * server component that prefetches the initial paged query and hydrates this
 * subtree (sitewide loading pattern — see
 * docs/plans/2026-07-15-sitewide-loading-pattern.md). Because the first-render
 * query is already in cache, only the route-level loading.tsx skeleton shows.
 *
 * This is the first relation-column list converted: the `style_id` column
 * resolves beer_style.name via the `__rel_` loop, which the server reproduces
 * from brandCore.listRelations.
 */

import { EntityList } from "@/components/universal/entity-list";
import { brandEntity } from "@/entities/brand";

export function BrandsClient() {
  return <EntityList entity={brandEntity} basePath="/settings/brands" />;
}
