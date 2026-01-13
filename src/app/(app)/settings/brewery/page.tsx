/**
 * Brewery Settings Page
 *
 * Configure brewery name, units, and general preferences.
 * This is a placeholder that will be expanded to include:
 * - Brewery name and address
 * - Default measurement units (volume, temperature, gravity)
 * - Tax region and reporting settings
 * - Logo and branding
 */

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, Settings } from "lucide-react";

export default function BrewerySettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6" />
            Brewery Settings
          </h1>
          <p className="text-muted-foreground">
            Configure your brewery information and preferences
          </p>
        </div>
      </div>

      {/* Coming Soon Notice */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings Configuration
          </CardTitle>
          <CardDescription>
            Brewery settings configuration is coming soon. This page will allow you to:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              Set brewery name, address, and contact information
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              Configure default measurement units (volume, temperature, gravity)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              Set tax region and TTB reporting preferences
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              Upload brewery logo and branding assets
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
