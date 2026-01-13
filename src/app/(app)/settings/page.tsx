/**
 * Settings Page
 *
 * Main settings hub with links to various configuration pages.
 */

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, Building2, Link2, Settings, DollarSign, Store, Layers } from "lucide-react";

const settingsLinks = [
  {
    title: "Brewery Settings",
    description: "Configure brewery name, units, and general preferences",
    href: "/settings/brewery",
    icon: Building2,
    available: false,
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
];

const pricingLinks = [
  {
    title: "Sales Channels",
    description: "Configure sales channels (distributor, retail, taproom)",
    href: "/settings/sales-channels",
    icon: Store,
  },
  {
    title: "Price Tiers",
    description: "Define pricing tiers (wholesale, retail, premium)",
    href: "/settings/price-tiers",
    icon: Layers,
  },
  {
    title: "Tier Prices",
    description: "Set prices by tier, product, and package type",
    href: "/settings/tier-prices",
    icon: DollarSign,
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

      {/* Pricing Settings */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Pricing Configuration
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pricingLinks.map((setting) => {
            const Icon = setting.icon;
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
    </div>
  );
}
