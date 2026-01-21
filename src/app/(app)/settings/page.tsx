/**
 * Settings Page
 *
 * Main settings hub with links to various configuration pages.
 */

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, Building2, Cog, Container, DollarSign, FlaskConical, Link2, List, MapPin, Package, Settings, Store, Users } from "lucide-react";

const settingsLinks = [
  {
    title: "System Settings",
    description: "Configure brewery info, tax rates, and compliance settings",
    href: "/settings/system",
    icon: Cog,
    available: true,
  },
  {
    title: "Brewery Settings",
    description: "Configure brewery name, units, and general preferences",
    href: "/settings/brewery",
    icon: Building2,
    available: true,
  },
  {
    title: "Users",
    description: "Manage team members and access permissions",
    href: "/settings/users",
    icon: Users,
    available: true,
  },
  {
    title: "Locations",
    description: "Manage warehouse and storage locations",
    href: "/settings/locations",
    icon: MapPin,
    available: true,
  },
  {
    title: "Notifications",
    description: "Configure notification preferences and delivery options",
    href: "/settings/notifications",
    icon: Bell,
    available: true,
  },
  {
    title: "Integrations",
    description: "Connect external services like Square, Slack, and QuickBooks",
    href: "/settings/integrations",
    icon: Link2,
    available: true,
  },
  {
    title: "Package Formats",
    description: "Manage package types for cans, bottles, kegs, and more",
    href: "/settings/formats",
    icon: Package,
    available: true,
  },
  {
    title: "Keg Types",
    description: "Manage keg sizes for inventory and deposit tracking",
    href: "/settings/keg-types",
    icon: Container,
    available: true,
  },
  {
    title: "Yeast Strains",
    description: "Manage yeast strain catalog for recipe building",
    href: "/settings/yeasts",
    icon: FlaskConical,
    available: true,
  },
  {
    title: "Sales Channels",
    description: "Configure sales channels for customer pricing tiers",
    href: "/settings/sales-channels",
    icon: Store,
    available: true,
  },
  {
    title: "Pricing",
    description: "Manage price tiers and format pricing",
    href: "/settings/pricing",
    icon: DollarSign,
    available: true,
  },
  {
    title: "Enum Registry",
    description: "Manage system enums and dropdown values (admin only)",
    href: "/settings/enums",
    icon: List,
    available: true,
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your brewery and account settings
        </p>
      </div>

      {/* Settings Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {settingsLinks.map((setting) => {
          const Icon = setting.icon;

          if (!setting.available) {
            return (
              <Card key={setting.href} className="opacity-50 cursor-not-allowed">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-5 w-5" />
                    {setting.title}
                  </CardTitle>
                  <CardDescription>{setting.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <span className="text-xs text-muted-foreground">Coming soon</span>
                </CardContent>
              </Card>
            );
          }

          return (
            <Link key={setting.href} href={setting.href}>
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-5 w-5" />
                    {setting.title}
                  </CardTitle>
                  <CardDescription>{setting.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
