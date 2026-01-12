"use client";

/**
 * Settings Hub Page
 *
 * Main settings page with navigation to sub-settings.
 */

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, MapPin, Users, Bell, Plug } from "lucide-react";

const settingsSections = [
  {
    title: "Brewery Info",
    description: "Name, address, TTB permits, and business defaults",
    href: "/settings/brewery",
    icon: Building2,
  },
  {
    title: "Locations",
    description: "Manage warehouses, taproom, and other facilities",
    href: "/settings/locations",
    icon: MapPin,
  },
  {
    title: "Users",
    description: "View team members and their roles",
    href: "/settings/users",
    icon: Users,
  },
  {
    title: "Notifications",
    description: "Configure alerts and notification preferences",
    href: "/settings/notifications",
    icon: Bell,
  },
  {
    title: "Integrations",
    description: "Connect to Square, Slack, QuickBooks, and more",
    href: "/settings/integrations",
    icon: Plug,
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your brewery configuration</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {settingsSections.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="p-2 rounded-lg bg-primary/10">
                  <section.icon className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{section.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>{section.description}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
