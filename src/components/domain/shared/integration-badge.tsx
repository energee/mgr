import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

/**
 * `error` = the status READ failed, so the connection state is unknown —
 * distinct from `not_connected` so a transient 500 doesn't prompt credential
 * re-entry (audit UI-10).
 */
export type IntegrationStatus = "connected" | "active" | "enabled" | "not_connected" | "error";

type IntegrationBadgeProps = {
  status: IntegrationStatus;
}

const statusConfig = {
  connected: { variant: "default", label: "Connected" },
  active: { variant: "default", label: "Active" },
  enabled: { variant: "secondary", label: "Enabled" },
  not_connected: { variant: "outline", label: "Not Connected" },
  error: { variant: "destructive", label: "Status Unavailable" },
} as const;

export function IntegrationBadge({ status }: IntegrationBadgeProps): ReactNode {
  const { variant, label } = statusConfig[status];
  return <Badge variant={variant}>{label}</Badge>;
}
