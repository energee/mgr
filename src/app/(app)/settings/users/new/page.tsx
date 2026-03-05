/**
 * Invite User Page
 *
 * Sends an email invitation to a new team member. The form collects an email
 * address, one or more roles, and an optional display name, then calls
 * POST /api/users/invite to create the auth user and send a magic-link email.
 *
 * On success, redirects to the user list with a success toast.
 */

"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, Mail, Loader2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { zodResolver } from "@/lib/form-resolver";
import { STAFF_ROLES } from "@/lib/permissions";

// ---------------------------------------------------------------------------
// Schema — mirrors the API route's inviteSchema
// ---------------------------------------------------------------------------

const inviteFormSchema = z.object({
  email: z.string().email("A valid email address is required"),
  roles: z
    .array(z.string())
    .min(1, "Select at least one role"),
  display_name: z.string().optional(),
});

type InviteFormValues = z.infer<typeof inviteFormSchema>;

// ---------------------------------------------------------------------------
// Role display labels
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  production_manager: "Production Manager",
  brewer: "Brewer",
  sales: "Sales",
  viewer: "Viewer",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Full access to all features, settings, and user management",
  production_manager: "Manage production, inventory, purchasing, and vessels",
  brewer: "Create and manage recipes, batches, and brew logs",
  sales: "Manage orders, customers, and deliveries",
  viewer: "Read-only access to all data",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InviteUserPage() {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<InviteFormValues>({
    resolver: zodResolver<InviteFormValues>(inviteFormSchema),
    defaultValues: {
      email: "",
      roles: [],
      display_name: "",
    },
  });

  const selectedRoles = watch("roles");

  const inviteMutation = useMutation({
    mutationFn: async (values: InviteFormValues) => {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          data.error?.message || "Failed to send invitation",
        );
      }

      return res.json();
    },
    onSuccess: (_data, variables) => {
      toast.success(`Invitation sent to ${variables.email}`);
      router.push("/settings/users");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function toggleRole(role: string) {
    const current = selectedRoles ?? [];
    const next = current.includes(role)
      ? current.filter((r) => r !== role)
      : [...current, role];
    setValue("roles", next, { shouldValidate: true });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Back link */}
      <Link
        href="/settings/users"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Users
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Invite Team Member</CardTitle>
          <CardDescription>
            Send an email invitation to a new team member. They will receive a
            magic link to set up their account.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form
            onSubmit={handleSubmit((values) =>
              inviteMutation.mutate(values)
            )}
            className="space-y-6"
          >
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">
                Email address <span className="text-destructive">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="name@brewery.com"
                autoComplete="email"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Display name (optional) */}
            <div className="space-y-2">
              <Label htmlFor="display_name">Display name</Label>
              <Input
                id="display_name"
                placeholder="John Smith (optional)"
                autoComplete="name"
                {...register("display_name")}
              />
              <p className="text-xs text-muted-foreground">
                If left blank, the part before @ in the email will be used.
              </p>
            </div>

            {/* Roles */}
            <div className="space-y-3">
              <Label>
                Roles <span className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground -mt-1">
                Permissions are additive across roles.
              </p>

              <div className="space-y-3">
                {STAFF_ROLES.map((role) => {
                  const isChecked = (selectedRoles ?? []).includes(role);
                  return (
                    <label
                      key={role}
                      className="flex items-start gap-3 cursor-pointer rounded-md border p-3 transition-colors hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleRole(role)}
                        className="mt-0.5"
                      />
                      <div className="space-y-0.5">
                        <span className="text-sm font-medium leading-none">
                          {ROLE_LABELS[role] ?? role}
                        </span>
                        {ROLE_DESCRIPTIONS[role] && (
                          <p className="text-xs text-muted-foreground">
                            {ROLE_DESCRIPTIONS[role]}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>

              {errors.roles && (
                <p className="text-sm text-destructive">
                  {errors.roles.message}
                </p>
              )}
            </div>

            {/* Submit */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/settings/users")}
                disabled={inviteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={inviteMutation.isPending}
              >
                {inviteMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Send Invitation
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
