"use client";

/**
 * Users Management Page
 *
 * View team members. Full user management requires Supabase Auth Admin.
 * For now, this shows users who have signed up and their preferences.
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Users, Mail, Clock, UserPlus } from "lucide-react";
import Link from "next/link";

interface UserPreference {
  id: string;
  user_id: string;
  volume_unit: string;
  weight_unit: string;
  temperature_unit: string;
  theme: string;
  created_at: string;
}

export default function UsersPage() {
  const supabase = createClient();

  // Get current user
  const { data: currentUser } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });

  // Get user preferences (as a proxy for users since we can't query auth.users directly)
  const { data: userPreferences, isLoading } = useQuery({
    queryKey: ["user-preferences-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as UserPreference[];
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/settings">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Users</h1>
            <p className="text-muted-foreground">View team members with access to MGR</p>
          </div>
        </div>
      </div>

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <UserPlus className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm">
                To invite new users, share your signup link with them. They will have access to MGR once they create an account.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Full role-based access control is coming in a future update.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current User */}
      {currentUser && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Your Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-lg font-semibold text-primary">
                  {currentUser.email?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="font-medium">{currentUser.email}</p>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Joined {new Date(currentUser.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>

            <div className="pt-4 border-t">
              <h4 className="text-sm font-medium mb-2">Your Preferences</h4>
              {userPreferences?.find((p) => p.user_id === currentUser.id) ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  {(() => {
                    const prefs = userPreferences.find((p) => p.user_id === currentUser.id);
                    return (
                      <>
                        <div>
                          <p className="text-muted-foreground">Volume</p>
                          <p className="font-medium">{prefs?.volume_unit?.toUpperCase()}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Weight</p>
                          <p className="font-medium">{prefs?.weight_unit?.toUpperCase()}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Temperature</p>
                          <p className="font-medium">{prefs?.temperature_unit === "f" ? "Fahrenheit" : "Celsius"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Theme</p>
                          <p className="font-medium capitalize">{prefs?.theme}</p>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No preferences set</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Other Users */}
      {userPreferences && userPreferences.filter((p) => p.user_id !== currentUser?.id).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Team Members</CardTitle>
            <CardDescription>Other users with access to this brewery</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {userPreferences
                .filter((p) => p.user_id !== currentUser?.id)
                .map((pref) => (
                  <div key={pref.id} className="flex items-center gap-3 py-2">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">User</p>
                      <p className="text-xs text-muted-foreground">
                        Joined {new Date(pref.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {(!userPreferences || userPreferences.length === 0) && !currentUser && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No users found</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
