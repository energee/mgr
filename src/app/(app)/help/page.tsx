"use client";

/**
 * Help Page
 *
 * Browsable, searchable user guide rendered from the shared help-content module.
 */

import { useState, useMemo } from "react";
import { HelpCircle, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { helpSections } from "@/lib/help-content";

export default function HelpPage() {
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

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
      } else {
        next.add(id);
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
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <HelpCircle className="h-6 w-6" />
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
            <div className="border rounded-lg">
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
                  {section.content}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </div>
    </div>
  );
}
