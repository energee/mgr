"use client";

/**
 * OrderQuickLinks - Quick Navigation for Order Detail
 *
 * Provides touch-friendly navigation to order sub-pages:
 * - Pick List (for warehouse fulfillment)
 * - Allocations (manage inventory allocations)
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ClipboardList, Package, ArrowRight } from "lucide-react";

interface OrderQuickLinksProps {
  data: {
    id: string;
    status: string;
  };
}

export function OrderQuickLinks({ data }: OrderQuickLinksProps) {
  // Show pick list for orders in picking states
  const showPickList = ["scheduled", "picking", "packed", "fulfilled"].includes(data.status);

  const links = [
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
      {links.map((link) => (
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
      ))}
    </div>
  );
}
