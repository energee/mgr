"use client";

/**
 * BatchQuickLinks - Quick Navigation for Batch Detail
 *
 * Provides touch-friendly navigation to batch sub-pages:
 * - Brew Log (linked hot-side log, if any)
 * - Readings (fermentation metrics)
 * - Additions (dry hops, fruit, etc.)
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { batchKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { unwrap } from "@/lib/supabase/query-helpers";

type BatchQuickLinksProps = {
  data: {
    id: string;
  };
};

export function BatchQuickLinks({ data }: BatchQuickLinksProps) {
  const supabase = createClient();

  const { data: brewLogLinks } = useQuery({
    queryKey: batchKeys.brewLogs(data.id),
    queryFn: async () => {
      const links = await unwrap(
        supabase
          .from("brew_log_batches")
          .select("brew_log_id, brew_log:brew_logs(brew_number)")
          .eq("batch_id", data.id)
          .limit(1)
      );
      return links ?? [];
    },
  });

  const primaryBrewLog = brewLogLinks?.[0];

  const links: {
    href: string;
    label: string;
    description: string;
  }[] = [];

  if (primaryBrewLog?.brew_log_id) {
    const brewLog = primaryBrewLog.brew_log as unknown as {
      brew_number: string;
    } | null;
    links.push({
      href: `/production/brew-logs/${primaryBrewLog.brew_log_id}`,
      label: "Brew Log",
      description: brewLog?.brew_number ?? "View hot-side brewing details",
    });
  }

  links.push(
    {
      href: `/production/batches/${data.id}/readings`,
      label: "Fermentation Readings",
      description: "Record gravity, temp, pH, and more",
    },
    {
      href: `/production/batches/${data.id}/additions`,
      label: "Additions",
      description: "Dry hops, fruit, finings, and adjuncts",
    },
  );

  return (
    <div
      className={`grid gap-3 ${links.length > 3 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}
    >
      {links.map((link) => (
        <Button
          key={link.href}
          variant="outline"
          className="h-auto flex-col items-start gap-1 p-4"
          asChild
        >
          <Link href={link.href}>
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
