/**
 * CustomerPortalAccess — staff-side management for customer portal logins.
 *
 * Lists every auth profile linked through customer_portal_users and supports
 * inviting, resending, and revoking individual contacts. Each contact keeps a
 * separate login while sharing access to this customer's portal records.
 */
"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/universal/status-badge";
import { usePermissions } from "@/contexts/permissions";
import { userProfileEntity } from "@/entities/user-profile";
import { formatValue } from "@/lib/format";
import { customerPortalKeys, entityKeys } from "@/lib/query-keys";

export type CustomerPortalUser = {
  userId: string;
  email: string | null;
  displayName: string | null;
  status: string | null;
  lastActiveAt: string | null;
  accessGrantedAt: string;
};

type CustomerPortalAccessProps = {
  customerId: string;
  primaryEmail?: string | null;
};

type InviteInput = {
  email: string;
  displayName?: string;
  mode: "invite" | "resend";
};

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? "Portal access request failed");
  }
  return body.data as T;
}

export function CustomerPortalAccess({
  customerId,
  primaryEmail,
}: CustomerPortalAccessProps) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManage = can("customers:write");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [revokeTarget, setRevokeTarget] =
    useState<CustomerPortalUser | null>(null);

  const {
    data: portalUsers = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: customerPortalKeys.users(customerId),
    queryFn: async () =>
      responseData<CustomerPortalUser[]>(
        await fetch(`/api/customers/${customerId}/portal-users`),
      ),
    enabled: !!customerId,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: customerPortalKeys.users(customerId),
      }),
      queryClient.invalidateQueries({ queryKey: entityKeys.all("user_profiles") }),
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("user_profiles_with_details"),
      }),
    ]);
  };

  const inviteMutation = useMutation({
    mutationFn: async (input: InviteInput) =>
      responseData<{ email: string; delivery: "invite" | "otp" }>(
        await fetch(`/api/customers/${customerId}/invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: input.email,
            displayName: input.displayName || undefined,
          }),
        }),
      ),
    onSuccess: async (result, input) => {
      await invalidate();
      toast.success(
        input.mode === "resend"
          ? `Login email sent to ${result.email}`
          : `Portal invitation sent to ${result.email}`,
      );
      if (input.mode === "invite") {
        setInviteOpen(false);
        setEmail("");
        setDisplayName("");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeMutation = useMutation({
    mutationFn: async (portalUser: CustomerPortalUser) =>
      responseData<{ revoked: boolean }>(
        await fetch(
          `/api/customers/${customerId}/portal-users/${portalUser.userId}`,
          { method: "DELETE" },
        ),
      ),
    onSuccess: async (_result, portalUser) => {
      await invalidate();
      setRevokeTarget(null);
      toast.success(`Portal access removed for ${portalUser.email ?? "user"}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function openInvite() {
    setEmail(portalUsers.length === 0 ? (primaryEmail ?? "") : "");
    setDisplayName("");
    setInviteOpen(true);
  }

  function submitInvite(event: FormEvent) {
    event.preventDefault();
    inviteMutation.mutate({
      email,
      displayName: displayName || undefined,
      mode: "invite",
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Each person signs in separately and can access this customer&apos;s
          portal orders and change requests.
        </p>
        {canManage && (
          <Button type="button" size="sm" onClick={openInvite}>
            <Plus className="h-4 w-4" />
            Invite portal user
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t load portal users.
        </p>
      ) : portalUsers.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No one has portal access yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last active</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {portalUsers.map((portalUser) => (
              <TableRow key={portalUser.userId}>
                <TableCell>
                  <span className="font-medium">
                    {portalUser.displayName || portalUser.email || "Portal user"}
                  </span>
                  {portalUser.email && (
                    <span className="block text-xs text-muted-foreground">
                      {portalUser.email}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {portalUser.status ? (
                    <StatusBadge
                      status={portalUser.status}
                      config={userProfileEntity.stateMachine?.stateDisplay}
                    />
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {formatValue(portalUser.lastActiveAt, "datetime")}
                </TableCell>
                {canManage && (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!portalUser.email || inviteMutation.isPending}
                        onClick={() => {
                          if (!portalUser.email) return;
                          inviteMutation.mutate({
                            email: portalUser.email,
                            mode: "resend",
                          });
                        }}
                      >
                        <Mail className="h-4 w-4" />
                        Resend
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove portal access for ${portalUser.email ?? "user"}`}
                        onClick={() => setRevokeTarget(portalUser)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a portal user</DialogTitle>
            <DialogDescription>
              This person will receive their own sign-in email and share access
              to this customer account.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="portal-user-email">Email</Label>
              <Input
                id="portal-user-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-user-name">Display name (optional)</Label>
              <Input
                id="portal-user-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInviteOpen(false)}
                disabled={inviteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={inviteMutation.isPending || !email.trim()}
              >
                {inviteMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!revokeTarget}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove portal access?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.email ?? "This user"} will no longer see this
              customer&apos;s orders. Their access to any other linked customer is
              unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revokeMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (revokeTarget) revokeMutation.mutate(revokeTarget);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
