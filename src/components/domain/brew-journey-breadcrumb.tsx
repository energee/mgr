"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface BreadcrumbSegment {
  label: string;
  href?: string; // undefined = current page (non-clickable)
}

interface BrewJourneyBreadcrumbProps {
  segments: BreadcrumbSegment[];
}

export function BrewJourneyBreadcrumb({ segments }: BrewJourneyBreadcrumbProps) {
  if (segments.length <= 1) return null;

  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {segments.map((segment, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {segment.href ? (
            <Link
              href={segment.href}
              className="hover:text-foreground transition-colors truncate max-w-[200px]"
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
