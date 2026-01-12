"use client";

/**
 * BatchQuickLinks - Quick Navigation for Batch Detail
 *
 * Provides touch-friendly navigation to batch sub-pages:
 * - Readings (fermentation metrics)
 * - Additions (dry hops, fruit, etc.)
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Thermometer, FlaskConical, History, ArrowRight } from "lucide-react";

interface BatchQuickLinksProps {
  data: {
    id: string;
  };
}

export function BatchQuickLinks({ data }: BatchQuickLinksProps) {
  const links = [
    {
      href: `/production/batches/${data.id}/readings`,
      label: "Fermentation Readings",
      description: "Record gravity, temp, pH, and more",
      icon: Thermometer,
    },
    {
      href: `/production/batches/${data.id}/additions`,
      label: "Additions",
      description: "Dry hops, fruit, finings, and adjuncts",
      icon: FlaskConical,
    },
    {
      href: `/production/batches/${data.id}/history`,
      label: "Batch History",
      description: "Timeline of all batch events",
      icon: History,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
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
