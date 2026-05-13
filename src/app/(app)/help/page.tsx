"use client";

/**
 * Help Page
 *
 * Browsable, searchable user guide rendered from the shared help-content module.
 */

import { useState, useMemo, useEffect, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { helpSections } from "@/lib/help-content";

/**
 * Converts text content into React nodes, turning paths like (/some/path)
 * into clickable Next.js Links.
 */
function linkifyContent(text: string): ReactNode[] {
  const parts = text.split(/(\(\/[a-z0-9/-]+\))/g);
  return parts.map((part, i) => {
    const match = part.match(/^\((\/[a-z0-9/-]+)\)$/);
    if (match) {
      const path = match[1];
      return (
        <Link
          key={i}
          href={path}
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          ({path})
        </Link>
      );
    }
    return part;
  });
}

export default function HelpPage() {
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  // Audit F-051: open the section that matches `#section-id` on mount so
  // help topics are shareable. Mirrors clicked-section state back to the
  // hash so a user can copy the URL of whatever they expand.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (hash && helpSections.some((s) => s.id === hash)) {
      setOpenSections((prev) => new Set(prev).add(hash));
      // Defer to next paint so the Collapsible has expanded before scrolling.
      requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return helpSections;
    const q = search.toLowerCase();
    return helpSections.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q)
    );
  }, [search]);

  const toggleSection = (id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // Clear the hash if we're collapsing the currently-anchored section.
        if (typeof window !== "undefined" && window.location.hash === `#${id}`) {
          history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      } else {
        next.add(id);
        // Sync the hash so the user can copy the URL of the section they just opened.
        if (typeof window !== "undefined") {
          history.replaceState(null, "", `#${id}`);
        }
      }
      return next;
    });
  };

  const expandAll = () => {
    setOpenSections(new Set(filtered.map((s) => s.id)));
  };

  const collapseAll = () => {
    setOpenSections(new Set());
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">
          Help
        </h1>
        <p className="text-muted-foreground mt-1">
          Learn how to use MGR to manage your brewery
        </p>
      </div>

      {/* Search + controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search help topics..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <button
          onClick={expandAll}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Expand all
        </button>
        <button
          onClick={collapseAll}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Collapse all
        </button>
      </div>

      {/* Sections */}
      {filtered.length === 0 && (
        <p className="text-muted-foreground text-sm py-8 text-center">
          No help topics match your search.
        </p>
      )}

      <div className="space-y-3">
        {filtered.map((section) => (
          <Collapsible
            key={section.id}
            open={openSections.has(section.id)}
            onOpenChange={() => toggleSection(section.id)}
          >
            <div id={section.id} className="border rounded-lg scroll-mt-4">
              <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors rounded-lg">
                <span className="font-medium">{section.title}</span>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                    openSections.has(section.id) ? "rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {linkifyContent(section.content)}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </div>
    </div>
  );
}
