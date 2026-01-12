"use client";

/**
 * Integrations Settings Page
 *
 * Connect to third-party services like Square, Slack, QuickBooks.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, CreditCard, MessageSquare, Calculator, Cloud, ShoppingBag, BarChart3 } from "lucide-react";
import Link from "next/link";

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: typeof CreditCard;
  status: "available" | "connected" | "coming_soon";
  category: string;
}

const integrations: Integration[] = [
  {
    id: "square",
    name: "Square",
    description: "Point of sale and payment processing for taproom sales",
    icon: CreditCard,
    status: "coming_soon",
    category: "Payments",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    description: "Sync invoices, expenses, and financial data",
    icon: Calculator,
    status: "coming_soon",
    category: "Accounting",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Get notifications and alerts in your Slack workspace",
    icon: MessageSquare,
    status: "coming_soon",
    category: "Communication",
  },
  {
    id: "shopify",
    name: "Shopify",
    description: "Sync inventory with your online store",
    icon: ShoppingBag,
    status: "coming_soon",
    category: "E-commerce",
  },
  {
    id: "untappd",
    name: "Untappd for Business",
    description: "Manage your digital menu and beer check-ins",
    icon: BarChart3,
    status: "coming_soon",
    category: "Marketing",
  },
  {
    id: "ekos",
    name: "Ekos",
    description: "Import data from Ekos brewery management",
    icon: Cloud,
    status: "coming_soon",
    category: "Migration",
  },
];

const groupedIntegrations = integrations.reduce((acc, integration) => {
  if (!acc[integration.category]) {
    acc[integration.category] = [];
  }
  acc[integration.category].push(integration);
  return acc;
}, {} as Record<string, Integration[]>);

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/settings">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Integrations</h1>
          <p className="text-muted-foreground">Connect MGR to your other tools</p>
        </div>
      </div>

      {/* Coming Soon Notice */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <ExternalLink className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-primary">Integrations Coming Soon</p>
              <p className="text-sm text-muted-foreground mt-1">
                We&apos;re working on integrations with popular brewery and business tools.
                Check back soon or let us know which integrations would be most valuable for your workflow.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Integrations by Category */}
      {Object.entries(groupedIntegrations).map(([category, categoryIntegrations]) => (
        <div key={category} className="space-y-4">
          <h2 className="text-lg font-semibold">{category}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categoryIntegrations.map((integration) => (
              <Card key={integration.id} className="opacity-75">
                <CardHeader className="flex flex-row items-start gap-4 space-y-0">
                  <div className="p-2 rounded-lg bg-muted">
                    <integration.icon className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{integration.name}</CardTitle>
                      <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded">
                        Coming Soon
                      </span>
                    </div>
                    <CardDescription className="mt-1">{integration.description}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" disabled className="w-full">
                    Connect
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {/* Request Integration */}
      <Card>
        <CardHeader>
          <CardTitle>Need a Different Integration?</CardTitle>
          <CardDescription>
            Let us know which tools you&apos;d like to connect with MGR
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <a href="mailto:support@mgr.app?subject=Integration Request">
              <ExternalLink className="h-4 w-4 mr-2" />
              Request Integration
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
