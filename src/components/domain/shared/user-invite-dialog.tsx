"use client";

/**
 * UserInviteDialog
 *
 * Surfaces the existing POST /api/users/invite endpoint to admins
 * (audit F-058). Without this dialog the invite endpoint was unreachable
 * from the UI, forcing scripted onboarding.
 *
 * Controlled component: the parent owns `open`/`onOpenChange` so the
 * dialog is triggered from the entity list's existing create button
 * (via `onCreateClick`) rather than a separate trigger button.
 */

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, UserPlus } from "lucide-react";
import { STAFF_ROLES, type StaffRole } from "@/lib/permissions";
import { usePermissions } from "@/contexts/permissions";
import { entityKeys } from "@/lib/query-keys";

const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin",
  production_manager: "Production manager",
  brewer: "Brewer",
  sales: "Sales",
  viewer: "Viewer",
};

type UserInviteDialogProps = {
  /** Whether the dialog is open (controlled by the parent). */
  open: boolean;
  /** Called when the dialog requests an open-state change. */
  onOpenChange: (open: boolean) => void;
}

export function UserInviteDialog({ open, onOpenChange }: UserInviteDialogProps) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("viewer");
  const [displayName, setDisplayName] = useState("");

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          roles: [role],
          display_name: displayName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data?.error?.message ?? data?.error ?? "Invite failed";
        throw new Error(message);
      }
      return data;
    },
    onSuccess: () => {
      toast.success(`Invitation sent to ${email}`);
      queryClient.invalidateQueries({ queryKey: entityKeys.list("user_profile") });
      setEmail("");
      setDisplayName("");
      setRole("viewer");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    inviteMutation.mutate();
  };

  // The backend route is gated by `users:manage`; render nothing for users
  // who can't actually complete the action (defense-in-depth — the parent
  // also hides the create button behind the same permission).
  if (!can("users:manage")) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            Sends a magic-link email. The user picks their password on first
            login.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="teammate@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
              <SelectTrigger id="invite-role" className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAFF_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-name">Display name (optional)</Label>
            <Input
              id="invite-name"
              placeholder="Defaults to the part before @"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="min-h-[44px]"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={inviteMutation.isPending}
              className="min-h-[44px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={inviteMutation.isPending || !email}
              className="min-h-[44px]"
            >
              {inviteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Send invitation
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
