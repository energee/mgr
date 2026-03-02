/**
 * Help Content
 *
 * Structured user guide content used by:
 * 1. The /help page (browsable, searchable)
 * 2. The AI assistant system prompt (condensed reference)
 *
 * Single source of truth for in-app help.
 */

export interface HelpSection {
  id: string;
  title: string;
  content: string;
}

export const helpSections: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    content: `MGR is a brewery management system for tracking production, inventory, purchasing, and sales.

After signing in you land on the Production Dashboard. The left sidebar organizes everything by domain: Dashboards, Production, Packaging, Inventory, Purchasing, Sales, Reports, and Settings.

Quick start:
- Set up your brewery info in Settings > Brewery Settings
- Add locations (warehouse, cold room, etc.) in Settings > Locations
- Add vessels (fermenters, brite tanks) in Production > Vessels
- Create recipes in Production > Recipes, then brew batches from them`,
  },
  {
    id: "navigation",
    title: "Navigation",
    content: `The sidebar on the left is the main navigation. Sections expand/collapse when clicked.

- Dashboards: Production, Inventory, and Sales overviews
- Production: Batches, Recipes, Vessels, Transfers, Brew Logs, Yeast Pitches, Planning
- Packaging: Packaging Sessions and Finished Goods
- Inventory: Inventory Items
- Purchasing: Ingredient Demand, Suppliers, Purchase Orders
- Sales: Orders, Pick Lists, Customers
- Reports: TTB Report and other analytics
- Settings: Brewery config, locations, users, integrations, catalog data
- Help: This guide (accessible from the sidebar footer)

The AI Assistant is available via the chat icon in the top-right header.`,
  },
  {
    id: "dashboards",
    title: "Dashboards",
    content: `Three dashboards give you an at-a-glance view:

Production Dashboard (/dashboard): Active batches, vessel utilization, upcoming tasks, and batch status counts.

Inventory Dashboard (/dashboard/inventory): Stock levels, low-stock alerts, and inventory value.

Sales Dashboard (/dashboard/sales): Open orders, revenue trends, and top customers.`,
  },
  {
    id: "production",
    title: "Production",
    content: `Production is the core of MGR. Key pages:

Planning (/production/planning): Visual calendar of scheduled batches and vessel availability.

Batches (/production/batches): Track batches through their lifecycle: Planned → Brewing → Fermenting → Conditioning → Carbonating → Completed. Create a new batch from a recipe or from scratch.

Recipes (/production/recipes): Define grain bills, hop schedules, yeast, and water profiles. The system auto-calculates OG, FG, ABV, IBU, and SRM estimates. Check style compliance against BJCP guidelines.

Vessels (/production/vessels): Manage fermenters, brite tanks, and other vessels. Track which batch is in each vessel.

Vessel Transfers (/production/vessel-transfers): Move beer between vessels (e.g., fermenter to brite tank).

Brew Logs (/production/brew-logs): Record measurements during brew day (temperatures, gravity readings, pH).

Yeast Pitches (/production/yeast-pitches): Track yeast usage and harvesting across batches.`,
  },
  {
    id: "packaging",
    title: "Packaging",
    content: `Packaging Sessions (/production/packaging): Record when beer is packaged into cans, bottles, or kegs. Link to a batch and specify quantities per format.

Finished Goods (/inventory/finished-goods): View packaged inventory ready for sale. Tracks quantities by brand and package format.`,
  },
  {
    id: "inventory",
    title: "Inventory",
    content: `Inventory Items (/inventory/items): All raw materials and supplies. Track quantities, costs, and locations. Items are allocated to batches automatically when brewing.

Inventory uses an allocation-based system -- quantities are calculated from allocation records, never stored as mutable balances. This ensures accuracy and full traceability.`,
  },
  {
    id: "purchasing",
    title: "Purchasing",
    content: `Ingredient Demand (/purchasing/demand): See what ingredients are needed based on planned batches vs. current stock.

Suppliers (/purchasing/suppliers): Manage your supplier contacts and catalogs.

Purchase Orders (/purchasing/pos): Create and track purchase orders. POs move through states: Draft → Submitted → Partially Received → Received.`,
  },
  {
    id: "sales",
    title: "Sales",
    content: `Orders (/sales/orders): Create and manage sales orders. Orders track customer, items, quantities, pricing, and fulfillment status.

Pick Lists (/sales/pick-lists): Generate pick lists from orders for warehouse staff to fulfill.

Customers (/sales/customers): Manage customer accounts, contacts, and pricing tiers.`,
  },
  {
    id: "reports",
    title: "Reports",
    content: `Reports (/reports): Hub for all reporting.

TTB Report (/reports/ttb): Generate the federal Brewer's Report of Operations (Form 5130.9) for tax compliance. Select a reporting period and the system calculates production, packaging, and inventory figures.`,
  },
  {
    id: "settings",
    title: "Settings",
    content: `Settings (/settings): Central configuration hub.

System Settings (/settings/system): API keys (Anthropic for AI assistant), tax rates, compliance settings.

Brewery Settings (/settings/brewery): Brewery name, units of measurement, general preferences.

Users (/settings/users): Manage team members and roles.

Locations (/settings/locations): Warehouses, cold rooms, and storage areas.

Notifications (/settings/notifications): Configure notification preferences.

Integrations (/settings/integrations): Connect Square, Slack, QuickBooks, and other services.

Catalog pages: Package Formats, Keg Types, Yeast Strains, Sales Channels, Pricing Tiers, and Enum Registry for managing lookup data used throughout the app.`,
  },
  {
    id: "ai-assistant",
    title: "AI Assistant",
    content: `The AI assistant (chat icon in the top-right) can help with:

- Brewing science questions (mashing, fermentation, water chemistry)
- Recipe formulation and style compliance
- Navigating MGR ("how do I create a batch?")
- Production planning advice
- BJCP style guidelines

To use it, configure an Anthropic API key in Settings > System Settings. Each user can also set a personal key in their preferences.`,
  },
  {
    id: "keyboard-shortcuts",
    title: "Keyboard Shortcuts",
    content: `MGR supports keyboard shortcuts for quick navigation and actions. Press ? anywhere to open the shortcuts dialog.

Global shortcuts (available on all pages):
- ? — Show keyboard shortcuts dialog
- / — Focus the search input
- Esc — Close dialog or clear focus
- Cmd+. (Mac) / Ctrl+. (Windows) — Toggle the AI assistant

List pages (e.g., Batches, Recipes, Orders):
- N — Create a new entity (when create is available)

Detail pages (e.g., viewing a single batch or recipe):
- E — Toggle into edit mode
- Backspace — Go back to list (prompts if unsaved changes)
- Esc — Cancel editing (prompts if unsaved changes)
- Cmd+Enter (Mac) / Ctrl+Enter (Windows) — Save changes

Shortcuts are automatically disabled when typing in input fields, textareas, or dropdown selects to avoid interference with data entry.`,
  },
  {
    id: "common-workflows",
    title: "Common Workflows",
    content: `Brew a batch:
1. Create a recipe (Production > Recipes > New) or use an existing one
2. Create a batch from the recipe (Production > Batches > New, select recipe)
3. Assign to a vessel
4. Record brew day measurements in Brew Logs
5. Advance batch status as it progresses (Brewing → Fermenting → etc.)

Package beer:
1. Go to Packaging > Sessions > New
2. Select the batch to package
3. Choose package formats and enter quantities
4. Packaged inventory appears in Finished Goods

Fulfill a sales order:
1. Create an order (Sales > Orders > New), select customer and items
2. Generate a pick list (Sales > Pick Lists)
3. Mark items as picked and order as fulfilled

Manage inventory:
1. Receive items via Purchase Orders (Purchasing > POs)
2. Items are auto-allocated to batches during brewing
3. Check stock levels on the Inventory Dashboard

Set up the AI assistant:
1. Go to Settings > System Settings
2. Enter your Anthropic API key
3. Click the chat icon in the header to start asking questions`,
  },
];

/**
 * Generate a condensed version of the help content for the AI system prompt.
 * Keeps token usage reasonable (~1.5-2k tokens).
 */
export function getHelpContentForSystemPrompt(): string {
  const lines = [
    "## MGR Application Guide",
    "",
    "You can help users navigate MGR. Here is what each section does and where to find it:",
    "",
  ];

  for (const section of helpSections) {
    lines.push(`### ${section.title}`);
    lines.push(section.content);
    lines.push("");
  }

  return lines.join("\n");
}
