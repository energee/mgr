/**
 * User Management Page
 *
 * List all users with role and activity information.
 */

"use client";

import Link from "next/link";
import { EntityList } from "@/components/universal/entity-list";
import { userProfileEntity } from "@/entities/user-profile";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function UsersSettingsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-muted-foreground">
            Manage team members and access permissions
          </p>
        </div>
      </div>

      {/* Entity List */}
      <EntityList
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entity={userProfileEntity as any}
        basePath="/settings/users"
      />
    </div>
  );
}
