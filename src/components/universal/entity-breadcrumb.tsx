"use client";

/**
 * EntityBreadcrumb
 *
 * Page-level breadcrumb shared across every entity detail route. In auto mode
 * (`entity` + `basePath` + `id`) the fetched record is deduped with the
 * `EntityDetailUnified` fetch via a shared React Query key. Use segments mode
 * for richer multi-hop trails (e.g. Recipe → Brew Log → Batch).
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { EntityConfig } from "@/types/entity";
import { useEntityRecord } from "@/hooks/use-entity-record";

export type BreadcrumbSegment = {
  label: string;
  /** Omit href for the current page (renders non-clickable). */
  href?: string;
};

type SegmentsProps = {
  segments: BreadcrumbSegment[];
};

type AutoProps<T extends Record<string, unknown>> = {
  entity: EntityConfig<T>;
  basePath: string;
  /** Omit for create mode; pass `currentLabel="New"` instead. */
  id?: string;
  /** Override the fetched title (used in create mode or when the parent already has the label). */
  currentLabel?: string;
};

export function EntityBreadcrumb<T extends Record<string, unknown>>(
  props: SegmentsProps | AutoProps<T>,
) {
  if ("segments" in props) {
    return <BreadcrumbNav segments={props.segments} />;
  }
  return <AutoBreadcrumb {...props} />;
}

function AutoBreadcrumb<T extends Record<string, unknown>>({
  entity,
  basePath,
  id,
  currentLabel,
}: AutoProps<T>) {
  const { data } = useEntityRecord(entity, id, { enabled: !currentLabel });
  const titleField = entity.detailHeader?.title;
  const fetchedTitle =
    titleField && data ? (data[titleField] as string | undefined) : undefined;
  const fallback = id ? `${entity.displayName} ${id}` : entity.displayName;
  const title = currentLabel ?? fetchedTitle ?? fallback;

  return (
    <BreadcrumbNav
      segments={[
        { label: entity.displayNamePlural, href: basePath },
        { label: title },
      ]}
    />
  );
}

function BreadcrumbNav({ segments }: SegmentsProps) {
  if (segments.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 text-xs">
      {segments.map((segment, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
          {segment.href ? (
            <Link
              href={segment.href}
              className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]"
            >
              {segment.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium truncate max-w-[200px]">
              {segment.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
