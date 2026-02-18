"use client";

/**
 * Settings Layout
 *
 * Persistent side navigation for all settings pages.
 * Groups settings into logical categories.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

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
      { label: "Keg Types", href: "/settings/keg-types" },
      { label: "Yeast Strains", href: "/settings/yeasts" },
      { label: "Water Profiles", href: "/settings/water-profiles" },
      { label: "Addition Profiles", href: "/settings/water-addition-profiles" },
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

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

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
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
