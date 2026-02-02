"use client";

/**
 * OrderQuickLinks - Quick Navigation for Order Detail
 *
 * Provides touch-friendly navigation to order sub-pages:
 * - Generate Pick List (creates formal pick list with FIFO)
 * - Pick List (for warehouse fulfillment)
 * - Allocations (manage inventory allocations)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ClipboardList, Package, ArrowRight, ListPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface OrderQuickLinksProps {
  data: {
    id: string;
    status: string;
  };
}

export function OrderQuickLinks({ data }: OrderQuickLinksProps) {
  const router = useRouter();
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const [isGenerating, setIsGenerating] = useState(false);

  // Show generate pick list for confirmed/allocated orders
  const canGenerate = ["confirmed", "scheduled"].includes(data.status);
  // Show pick list for orders in picking states
  const showPickList = ["scheduled", "picking", "packed", "fulfilled"].includes(data.status);

  // Generate pick list mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      setIsGenerating(true);
      const { data: pickListId, error } = await db
        .rpc("generate_pick_list", { p_order_id: data.id });

      if (error) throw error;
      return pickListId as string;
    },
    onSuccess: (pickListId) => {
      toast.success("Pick list generated");
      router.push(`/sales/pick-lists/${pickListId}`);
    },
    onError: (error) => {
      toast.error(`Failed to generate pick list: ${error.message}`);
      setIsGenerating(false);
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
            href: `/sales/orders/${data.id}/pick-list`,
            label: "Pick List",
            description: "View and print pick list for warehouse",
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
    <div className={`grid gap-3 sm:grid-cols-${Math.min(links.length, 3)}`}>
      {links.map((link) => {
        if ("action" in link && link.action) {
          return (
            <Button
              key={link.label}
              variant="outline"
              className="h-auto flex-col items-start gap-1 p-4"
              onClick={link.action}
              disabled={isGenerating}
            >
              <div className="flex w-full items-center justify-between">
                {isGenerating ? (
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
