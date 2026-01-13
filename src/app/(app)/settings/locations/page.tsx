/**
 * Locations Settings Page
 *
 * Manage physical locations (warehouses, taproom, storage).
 * This is a placeholder that will be expanded to include:
 * - Location CRUD
 * - Storage zones within locations
 * - Default location for inventory operations
 */

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, Warehouse } from "lucide-react";

export default function LocationsSettingsPage() {
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
            <MapPin className="h-6 w-6" />
            Locations
          </h1>
          <p className="text-muted-foreground">
            Manage warehouse and storage locations
          </p>
        </div>
      </div>

      {/* Coming Soon Notice */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            Location Management
          </CardTitle>
          <CardDescription>
            Location management is coming soon. This page will allow you to:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              Create and manage physical locations (brewery, warehouse, taproom)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              Define storage zones within each location
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              Set default locations for different inventory operations
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              Track inventory by location for multi-site operations
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
