import { Badge } from "@/components/ui/badge";

export type IntegrationStatus = "connected" | "active" | "enabled" | "not_connected";

const statusConfig = {
  connected: { variant: "default", label: "Connected" },
  active: { variant: "default", label: "Active" },
  enabled: { variant: "secondary", label: "Enabled" },
  not_connected: { variant: "outline", label: "Not Connected" },
} as const;

export function IntegrationBadge({ status }: { status: IntegrationStatus }) {
  const { variant, label } = statusConfig[status];
  return <Badge variant={variant}>{label}</Badge>;
}
