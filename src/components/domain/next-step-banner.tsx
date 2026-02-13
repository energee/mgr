"use client";

/**
 * NextStepBanner - Contextual guidance banner for entity detail pages
 *
 * Displays a colored strip with a message and action button(s) to guide
 * users to the next logical step in a workflow (e.g., "Start brewing" or
 * "Record your first reading").
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BannerAction {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}

interface NextStepBannerProps {
  message: string;
  actions: BannerAction[];
  variant?: "info" | "success" | "default";
}

const variantStyles = {
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  success:
    "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100",
  default: "border-border bg-muted/50 text-foreground",
} as const;

export function NextStepBanner({
  message,
  actions,
  variant = "default",
}: NextStepBannerProps) {
  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${variantStyles[variant]}`}
    >
      <p className="text-sm font-medium">{message}</p>
      <div className="flex shrink-0 items-center gap-2">
        {actions.map((action) =>
          action.href ? (
            <Button
              key={action.label}
              variant="outline"
              size="sm"
              className="min-h-[36px]"
              asChild
            >
              <Link href={action.href}>
                {action.icon}
                {action.label}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <Button
              key={action.label}
              variant="outline"
              size="sm"
              className="min-h-[36px]"
              onClick={action.onClick}
            >
              {action.icon}
              {action.label}
            </Button>
          )
        )}
      </div>
    </div>
  );
}

export type { NextStepBannerProps, BannerAction };
