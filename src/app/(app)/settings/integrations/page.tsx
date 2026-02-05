/**
 * Integrations Settings Page
 *
 * Placeholder for external service integrations:
 * - Square POS (order sync)
 * - Slack (notifications)
 * - QuickBooks (accounting)
 *
 * These integrations require API credentials and OAuth setup
 * that are out of scope for the initial implementation.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, MessageSquare, CreditCard, Calculator } from "lucide-react";

const integrations = [
  {
    id: "square",
    name: "Square POS",
    description: "Sync orders from Square Point of Sale. Automatically import taproom and retail sales.",
    icon: CreditCard,
    status: "coming_soon" as const,
    features: [
      "Automatic order import",
      "Real-time inventory sync",
      "Customer data integration",
    ],
    docsUrl: "https://developer.squareup.com/docs",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send notifications to Slack channels. Get alerts for low inventory, batch status changes, and more.",
    icon: MessageSquare,
    status: "coming_soon" as const,
    features: [
      "Channel notifications",
      "Customizable alerts",
      "Batch status updates",
    ],
    docsUrl: "https://api.slack.com/",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    description: "Sync financial data with QuickBooks Online. Automate invoicing and expense tracking.",
    icon: Calculator,
    status: "coming_soon" as const,
    features: [
      "Invoice sync",
      "Expense tracking",
      "Inventory valuation",
    ],
    docsUrl: "https://developer.intuit.com/",
  },
];

function getStatusBadge(status: "connected" | "coming_soon" | "disconnected") {
  switch (status) {
    case "connected":
      return <Badge variant="default">Connected</Badge>;
    case "coming_soon":
      return <Badge variant="secondary">Coming Soon</Badge>;
    case "disconnected":
      return <Badge variant="outline">Not Connected</Badge>;
  }
}

export default function IntegrationsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-muted-foreground">
          Connect external services to extend your brewery management
        </p>
      </div>

      {/* Info Banner */}
      <div className="bg-muted/50 border rounded-lg p-4">
        <h3 className="font-medium mb-1">External Integrations</h3>
        <p className="text-sm text-muted-foreground">
          These integrations connect MGR with external services like Square POS, Slack, and QuickBooks.
          Each integration requires API credentials and OAuth configuration. Contact support for
          setup assistance.
        </p>
      </div>

      {/* Integration Cards */}
      <div className="space-y-4">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          const isAvailable = integration.status !== "coming_soon";

          return (
            <Card
              key={integration.id}
              className={!isAvailable ? "opacity-75" : ""}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{integration.name}</CardTitle>
                      <CardDescription className="mt-1">
                        {integration.description}
                      </CardDescription>
                    </div>
                  </div>
                  {getStatusBadge(integration.status)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Features</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {integration.features.map((feature, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col gap-2">
                    {isAvailable ? (
                      <Button>Configure</Button>
                    ) : (
                      <Button disabled variant="outline">
                        Coming Soon
                      </Button>
                    )}
                    <a
                      href={integration.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      API Docs <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Custom Integration Section */}
      <Card>
        <CardHeader>
          <CardTitle>Custom Integrations</CardTitle>
          <CardDescription>
            Need to integrate with a service not listed here? MGR provides a webhook system
            and REST API for custom integrations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Button variant="outline" disabled>
              API Documentation
              <Badge variant="secondary" className="ml-2">Coming Soon</Badge>
            </Button>
            <Button variant="outline" disabled>
              Webhook Settings
              <Badge variant="secondary" className="ml-2">Coming Soon</Badge>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
