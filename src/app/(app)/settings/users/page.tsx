/**
 * User Management Page
 *
 * Manage team members and their roles.
 * This is a placeholder that will be expanded to include:
 * - User list with roles
 * - Invite new users
 * - Role assignment
 * - Activity tracking
 */

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, UserPlus } from "lucide-react";

export default function UsersSettingsPage() {
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
            <Users className="h-6 w-6" />
            User Management
          </h1>
          <p className="text-muted-foreground">
            Manage team members and access permissions
          </p>
        </div>
      </div>

      {/* Coming Soon Notice */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Team Management
          </CardTitle>
          <CardDescription>
            User management is coming soon. This page will allow you to:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              View all team members and their roles
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              Invite new users to join the brewery
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              Assign roles and permissions (Admin, Brewer, Sales, etc.)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              Track user activity and audit logs
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
