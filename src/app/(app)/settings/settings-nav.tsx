"use client";

/**
 * Settings Navigation (client component)
 *
 * Persistent side navigation for all settings pages.
 * Desktop: sidebar nav (hidden on mobile via `hidden md:block`).
 * Mobile: dropdown select at the top of the content area (`md:hidden`).
 * Both use the same `settingsNav` data structure.
 *
 * Extracted from settings/layout.tsx so the layout can be a server component
 * and export Next.js metadata for browser tab titles.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const settingsNav = [
  {
    heading: "General",
    items: [
      { label: "Account", href: "/settings/account" },
      { label: "System", href: "/settings/system" },
      { label: "Brewery", href: "/settings/brewery" },
      { label: "Users", href: "/settings/users" },
      { label: "Notifications", href: "/settings/notifications" },
      { label: "Integrations", href: "/settings/integrations" },
    ],
  },
  {
    heading: "Catalogs",
    items: [
      { label: "Locations", href: "/settings/locations" },
      { label: "Package Formats", href: "/settings/formats" },
      { label: "Kegs", href: "/settings/keg-types" },
      { label: "Yeast Strains", href: "/settings/yeasts" },
      { label: "Water", href: "/settings/water-profiles" },
      { label: "Beer Styles", href: "/settings/beer-styles" },
      { label: "Brands", href: "/settings/brands" },
    ],
  },
  {
    heading: "Commerce",
    items: [
      { label: "Sales Channels", href: "/settings/sales-channels" },
      { label: "Pricing", href: "/settings/pricing" },
    ],
  },
  {
    heading: "Admin",
    items: [
      { label: "Status & Options", href: "/settings/status-options" },
    ],
  },
];

/**
 * Finds the label for the current pathname from the settingsNav structure.
 * Returns the matching item's label, or undefined if no match.
 */
function findCurrentLabel(pathname: string): string | undefined {
  for (const group of settingsNav) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        return item.label;
      }
    }
  }
  return undefined;
}

export function SettingsNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const currentLabel = findCurrentLabel(pathname);

  return (
    <div className="flex gap-8">
      <nav className="w-48 shrink-0 hidden md:block">
        <h1 className="text-lg font-semibold mb-4">Settings</h1>
        {settingsNav.map((group) => (
          <div key={group.heading} className="mb-4">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 px-2">
              {group.heading}
            </h2>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "block px-2 py-1.5 text-sm rounded-md transition-colors",
                      pathname === item.href ||
                        pathname.startsWith(item.href + "/")
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className="flex-1 min-w-0">
        {/* Mobile settings navigation -- visible only below md breakpoint */}
        <div className="md:hidden mb-4">
          <h1 className="text-lg font-semibold mb-2">Settings</h1>
          <Select
            value={pathname}
            onValueChange={(href) => router.push(href)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Navigate to...">
                {currentLabel ?? "Select a section"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {settingsNav.map((group) => (
                <SelectGroup key={group.heading}>
                  <SelectLabel>{group.heading}</SelectLabel>
                  {group.items.map((item) => (
                    <SelectItem key={item.href} value={item.href}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        {children}
      </main>
    </div>
  );
}
