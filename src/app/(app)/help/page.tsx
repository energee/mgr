"use client";

/**
 * Help Page
 *
 * Browsable, searchable user guide rendered from the shared help-content module.
 * Content is rendered as markdown via Streamdown (audit F-053) so help authors
 * can use proper formatting (bold, lists, links, code) instead of the previous
 * fragile (/path)-only mini-parser.
 *
 * Backwards-compat: bare `(/path)` mentions are auto-promoted to markdown links
 * so existing entries continue to render as clickable links.
 */

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Streamdown } from "streamdown";
import type { Components } from "streamdown";
import { helpSections } from "@/lib/help-content";

/**
 * Convert legacy `(/path)` mentions in help content into proper markdown
 * link syntax `[/path](/path)`. Lets the existing content render with
 * clickable links under Streamdown without rewriting every entry.
 *
 * Skip matches that already look like markdown link tails to avoid
 * double-wrapping when help-content.ts is migrated entry-by-entry.
 */
function promoteLegacyPathMentions(content: string): string {
  return content.replace(/(\]\()?\((\/[a-z0-9/-]+)\)/g, (match, mdTail, path) => {
    if (mdTail) return match; // already inside `](…)` — leave alone
    return `[${path}](${path})`;
  });
}

/**
 * Custom anchor renderer for Streamdown.
 *
 * Streamdown's default (via `rehype-harden`) forces `target="_blank"` and
 * `rel="noreferrer"` on every link. For the help page that is wrong for
 * internal app paths (`/inventory`, `/recipes`, etc.) — those should
 * navigate in-app via Next.js `<Link>` without opening a new tab. External
 * links keep `target="_blank"` and gain `rel="noopener noreferrer"` for
 * reverse-tabnabbing safety.
 */
const helpMarkdownComponents: Components = {
  a: ({ href, children, ...rest }) => {
    const url = typeof href === "string" ? href : "";
    const isInternal = url.startsWith("/") && !url.startsWith("//");
    if (isInternal) {
      // Strip any target/rel rehype-harden may have injected so internal
      // navigation stays in the same tab.
      const { target: _t, rel: _r, node: _n, ...safe } = rest as Record<string, unknown>;
      void _t; void _r; void _n;
      return (
        <Link href={url} {...(safe as Record<string, unknown>)}>
          {children}
        </Link>
      );
    }
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  },
};

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
      // Defer setState to a rAF callback — calling setState synchronously in an
      // effect body triggers the react-hooks/set-state-in-effect lint rule.
      requestAnimationFrame(() => {
        setOpenSections((prev) => new Set(prev).add(hash));
        // Scroll after a second frame so the Collapsible has expanded first.
        requestAnimationFrame(() => {
          document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
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
        {/* Audit F-052: use the shared Button primitive so focus ring + sizing
            tokens are consistent with the rest of the app. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={expandAll}
          className="text-muted-foreground hover:text-foreground"
        >
          Expand all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={collapseAll}
          className="text-muted-foreground hover:text-foreground"
        >
          Collapse all
        </Button>
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
                <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground leading-relaxed prose prose-sm max-w-none dark:prose-invert prose-a:text-primary prose-headings:text-foreground prose-strong:text-foreground prose-code:text-foreground">
                  <Streamdown components={helpMarkdownComponents}>
                    {promoteLegacyPathMentions(section.content)}
                  </Streamdown>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}
      </div>
    </div>
  );
}
