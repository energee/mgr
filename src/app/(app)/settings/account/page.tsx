"use client";

/**
 * Account Settings Page
 *
 * Personal settings for the current user:
 * - Avatar upload
 * - Display name
 * - Personal API key for Anthropic Claude
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Loader2 } from "lucide-react";
import { ClaudeIcon } from "@/components/ui/claude-icon";
import { AvatarUpload } from "@/components/domain/avatar-upload";
import { entityKeys, userKeys } from "@/lib/query-keys";

// =============================================================================
// Profile Section
// =============================================================================

function ProfileSection() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: userKeys.current(),
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("user_profiles")
        .select("id, display_name, email, avatar_url")
        .eq("id", user.id)
        .single();

      if (error) throw error;
      return data as { id: string; display_name: string | null; email: string | null; avatar_url: string | null };
    },
  });

  const updateProfile = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase
        .from("user_profiles")
        .update({ display_name: name })
        .eq("id", profile!.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.current() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("user_profile") });
      toast.success("Display name updated");
    },
    onError: () => {
      toast.error("Failed to update display name");
    },
  });

  if (isLoading || !profile) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Loading profile...
        </CardContent>
      </Card>
    );
  }

  return (
    <ProfileForm
      profile={profile}
      onSave={(name) => updateProfile.mutate(name)}
      isPending={updateProfile.isPending}
    />
  );
}

function ProfileForm({
  profile,
  onSave,
  isPending,
}: {
  profile: { id: string; display_name: string | null; email: string | null; avatar_url: string | null };
  onSave: (name: string) => void;
  isPending: boolean;
}) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const hasChanged = displayName !== (profile.display_name ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Your personal information visible to other team members
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <AvatarUpload
          userId={profile.id}
          avatarUrl={profile.avatar_url}
          displayName={profile.display_name}
        />
        {profile.email && (
          <div className="grid gap-2">
            <Label>Email</Label>
            <p className="text-sm text-muted-foreground">{profile.email}</p>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="display_name">Display Name</Label>
          <div className="flex gap-2">
            <Input
              id="display_name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="John Smith"
            />
            <Button
              type="button"
              onClick={() => onSave(displayName)}
              disabled={!displayName || !hasChanged || isPending}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Personal API Key Section
// =============================================================================

function PersonalApiKeySection() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings/api-key?scope=user")
      .then((res) => res.json())
      .then((data) => {
        setHasExistingKey(data.hasKey === true);
        setKeyHint(data.keyHint ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const saveKey = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch("/api/settings/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "user", key }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
    },
    onSuccess: (_data, key) => {
      queryClient.invalidateQueries({ queryKey: userKeys.preferences() });
      if (key) {
        setHasExistingKey(true);
        setKeyHint(`...${key.slice(-4)}`);
      } else {
        setHasExistingKey(false);
        setKeyHint(null);
      }
      setApiKey("");
      setIsEditing(false);
      toast.success(key ? "API key saved" : "API key removed");
    },
    onError: () => {
      toast.error("Failed to save API key");
    },
  });

  if (!loaded) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClaudeIcon className="h-5 w-5 text-[#D97757]" />
          Anthropic Claude
        </CardTitle>
        <CardDescription>
          Set your personal API key for Anthropic Claude.
          This overrides the global key set in Integrations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasExistingKey && !isEditing ? (
          <>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-600" />
                <span>Configured</span>
                {keyHint && (
                  <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    sk-ant-{keyHint}
                  </code>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                >
                  Change
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => saveKey.mutate("")}
                  disabled={saveKey.isPending}
                >
                  Remove
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave blank to use the brewery&apos;s global key.
            </p>
          </>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="anthropic_api_key">Anthropic API Key</Label>
            <div className="flex gap-2">
              <Input
                id="anthropic_api_key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                autoComplete="off"
              />
              <Button
                type="button"
                onClick={() => saveKey.mutate(apiKey)}
                disabled={!apiKey || saveKey.isPending}
              >
                {saveKey.isPending ? "Saving..." : "Save"}
              </Button>
              {hasExistingKey && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    setApiKey("");
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Optional. Get your key from{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                console.anthropic.com
              </a>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Component
// =============================================================================

export default function AccountSettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-lg font-medium">Account</h1>
        <p className="text-muted-foreground">
          Personal settings for your account
        </p>
      </div>

      <ProfileSection />

      <PersonalApiKeySection />
    </div>
  );
}
