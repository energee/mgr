"use client";

/**
 * OrderQuickLinks - Quick Navigation for Order Detail
 *
 * Provides touch-friendly navigation to order sub-pages:
 * - Generate Pick List (creates formal pick list with FIFO)
 * - Pick List (links to formal pick list if one exists, otherwise legacy page)
 * - Allocations (manage inventory allocations)
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { unwrap } from "@/lib/supabase/query-helpers";
import { pickListKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ClipboardList, Package, ArrowRight, ListPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

type OrderQuickLinksProps = {
  data: {
    id: string;
    status: string;
  };
}

export function OrderQuickLinks({ data }: OrderQuickLinksProps) {
  const router = useRouter();
  const supabase = createClient();

  // Fetch any existing formal pick list for this order (non-cancelled)
  const { data: formalPickList } = useQuery({
    queryKey: pickListKeys.forOrder(data.id),
    queryFn: async () => {
      return await unwrap(supabase
        .from("pick_lists")
        .select("id, status")
        .eq("order_id", data.id)
        .neq("status", "cancelled")
        .limit(1)
        .maybeSingle()) as { id: string; status: string } | null;
    },
  });

  // Show generate pick list for confirmed/allocated orders (only if no active pick list exists)
  const canGenerate = ["confirmed", "scheduled"].includes(data.status) && !formalPickList;
  // Show pick list for orders in picking states
  const showPickList = ["scheduled", "picking", "packed", "fulfilled"].includes(data.status);

  // Generate pick list mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      return await unwrap(supabase
        .rpc("generate_pick_list", { p_order_id: data.id })) as string;
    },
    onSuccess: (pickListId) => {
      toast.success("Pick list generated");
      router.push(`/sales/pick-lists/${pickListId}`);
    },
    onError: (error) => {
      toast.error(`Failed to generate pick list: ${error.message}`);
    },
  });

  const links = [
    ...(canGenerate
      ? [
          {
            href: "#generate",
            label: "Generate Pick List",
            description: "Create a pick list with FIFO allocation",
            icon: ListPlus,
            action: () => generateMutation.mutate(),
          },
        ]
      : []),
    ...(showPickList
      ? [
          {
            href: formalPickList
              ? `/sales/pick-lists/${formalPickList.id}`
              : `/sales/orders/${data.id}/pick-list`,
            label: "Pick List",
            description: formalPickList
              ? "View formal pick list with FIFO allocation"
              : "View and print pick list for warehouse",
            icon: ClipboardList,
          },
        ]
      : []),
    {
      href: `/sales/orders/${data.id}/allocations`,
      label: "Manage Allocations",
      description: "View and adjust inventory allocations",
      icon: Package,
    },
  ];

  if (links.length === 0) return null;

  return (
    <div className={cn("grid gap-3", {
      "sm:grid-cols-1": links.length === 1,
      "sm:grid-cols-2": links.length === 2,
      "sm:grid-cols-3": links.length >= 3,
    })}>
      {links.map((link) => {
        if ("action" in link && link.action) {
          return (
            <Button
              key={link.label}
              variant="outline"
              className="h-auto flex-col items-start gap-1 p-4"
              onClick={link.action}
              disabled={generateMutation.isPending}
            >
              <div className="flex w-full items-center justify-between">
                {generateMutation.isPending ? (
                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                ) : (
                  <link.icon className="h-5 w-5 text-primary" />
                )}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-left">
                <div className="font-medium">{link.label}</div>
                <div className="text-xs text-muted-foreground font-normal">
                  {link.description}
                </div>
              </div>
            </Button>
          );
        }

        return (
          <Button
            key={link.href}
            variant="outline"
            className="h-auto flex-col items-start gap-1 p-4"
            asChild
          >
            <Link href={link.href}>
              <div className="flex w-full items-center justify-between">
                <link.icon className="h-5 w-5 text-primary" />
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-left">
                <div className="font-medium">{link.label}</div>
                <div className="text-xs text-muted-foreground font-normal">
                  {link.description}
                </div>
              </div>
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
