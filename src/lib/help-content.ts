/**
 * Help Content
 *
 * Structured user guide content used by:
 * 1. The /help page (browsable, searchable)
 * 2. The AI assistant system prompt (condensed reference)
 *
 * Single source of truth for in-app help.
 */

export type HelpSection = {
  id: string;
  title: string;
  /**
   * Help body. Authored as GitHub-flavored markdown. Rendered on the /help
   * page via Streamdown (audit F-053) — supports headings, bold, italic,
   * lists, inline code, code blocks, and links. Internal app links use
   * standard `[label](/path)` syntax; bare `(/path)` mentions are also
   * auto-promoted to links for backwards-compat with pre-F-053 entries.
   *
   * The same string is fed verbatim to the AI assistant via
   * `getHelpContentForSystemPrompt()`. Plain prose, bullets, and inline
   * links remain coherent in both contexts; avoid renderer-only constructs
   * (HTML, tables) unless they read well as raw text too.
   */
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
- Production: Planning, Backward Planning, Batches, Recipes, Vessels, Transfers, Brew Logs, Yeast Pitches
- Packaging: Packaging Sessions
- Inventory: Raw Materials, Finished Goods, Lots, Allocations, Kegs, Bins, Transfers, Deliveries
- Purchasing: Material Planning, Ingredient Demand, Suppliers, Purchase Orders
- Sales: Orders, Pick Lists, Customers
- Reports: TTB Report, Production Summary, Inventory Valuation, Batch Cost, Projections, COGS
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

Each session's detail page has a Bill of Materials preview tab that shows the packaging materials needed (lids, trays, PakTechs, labels, etc.) based on the line items' selling formats. The preview compares required quantity against on-hand inventory and highlights any shortfalls in red, with a link to /purchasing/material-planning for ordering. See "Bills of Materials" below for how the math works.`,
  },
  {
    id: "bills-of-materials",
    title: "Bills of Materials (BOMs)",
    content: `A Bill of Materials (BOM) defines what packaging materials are needed per unit of a given selling format. Edit a format's BOM at Settings > Selling Formats > [format] > Bill of Materials.

Two kinds of materials, distinguished by the inventory item's Unit:

Whole-unit materials (Unit = "each" or "case"): trays, lids, PakTechs, carriers, keg caps — anything you count in discrete pieces. The BOM editor shows two inputs: "[X] per [Y]". To say "1 tray per 24 cans," type 1 and 24. To say "2 lids per can," type 2 and 1. The system rounds material need up to whole numbers and ignores fractions of an item.

Bulk materials (Unit = "lb", "oz", "kg", "g", "gal"): adhesive, ink, CO2 — anything measured by mass or volume. The BOM editor shows a single decimal field for the quantity used per unit; the preview keeps decimal precision.

How material demand is computed: for each line item in a packaging session, the system multiplies the planned quantity by each BOM row's ratio. Whole-unit results are ceiled (you can't use half a tray); bulk results stay as decimals. The aggregated total appears in the session's Bill of Materials tab and in Material Planning (/purchasing/material-planning).

Notes:
- BOMs live on the selling format, not the brand or batch — every batch packaged into "Case of 12" uses the same materials.
- Materials are derived through the BOM chain (session line item → selling format BOM → inventory item). There is no direct way to "assign" a material to a session outside the BOM.
- If you change a BOM, future sessions reflect the new ratios; completed sessions are unaffected.`,
  },
  {
    id: "inventory",
    title: "Inventory",
    content: `Inventory uses an allocation-based system -- quantities are calculated from allocation records, never stored as mutable balances. This ensures accuracy and full traceability.

Raw Materials (/inventory/items): All raw materials and supplies. Track quantities, costs, and locations. Items are allocated to batches automatically when brewing.

Finished Goods (/inventory/finished-goods): View packaged inventory ready for sale. Tracks quantities by brand and package format.

Lots (/inventory/lots): Track inventory by lot number for traceability. Each lot ties back to a supplier delivery or production run.

Allocations (/inventory/allocations): View and manage inventory allocations -- the records that link inventory to batches, orders, and other consumers.

Kegs (/inventory/kegs): Track individual kegs through fill, dispatch, and return cycles.

Bins (/inventory/bins): Manage storage bins and their contents within locations.

Transfers (/inventory/transfers): Move inventory between locations (e.g., warehouse to cold room).

Deliveries (/inventory/deliveries): Record incoming deliveries from suppliers. Links to purchase orders and creates lot records.`,
  },
  {
    id: "purchasing",
    title: "Purchasing",
    content: `Material Planning (/purchasing/material-planning): Unified view of all material needs across brewing, packaging, and shipping. Shows what you need, what's in stock, what's on order, shortfalls, and "order by" dates based on supplier lead times. Filter by horizon (2-12 weeks), demand source (brewing/packaging/shipping), or shortfalls only. Past-due items are highlighted in red, items needing orders in amber.

The system calculates demand from three sources:
- Brewing: planned batches and their recipe ingredients
- Packaging: planned sessions and their selling format bills of materials (BOMs)
- Shipping: confirmed orders and their pallet/wrap requirements

Ingredient Demand (/purchasing/demand): See what ingredients are needed based on planned batches vs. current stock.

Suppliers (/purchasing/suppliers): Manage your supplier contacts and catalogs. Suppliers can now be linked to packaging materials and shipping supplies (not just brewing ingredients) via the supplier catalog.

Purchase Orders (/purchasing/pos): Create and track purchase orders. POs move through states: Draft → Submitted → Partially Received → Received.

Recording a receipt: open a PO, find the line item, and click Receive. The receive dialog records what physically arrived. If the supplier ships in bundles (e.g., 10 stacks of 250 trays), check "Received in bundles" — it reveals a "bundles × per-bundle" calculator that fills in the total Quantity for you. Bundle size is not saved; the system only stores the single-unit quantity (2,500 trays in the example).`,
  },
  {
    id: "sales",
    title: "Sales",
    content: `Orders (/sales/orders): Create and manage sales orders. Orders track customer, items, quantities, pricing, and fulfillment status.

Pick Lists (/sales/pick-lists): Generate pick lists from orders for warehouse staff to fulfill.

Customers (/sales/customers): Manage customer accounts, contacts, and pricing tiers. Each customer can have shipping preferences (preferred pallet type, wrap type) and pallet layer overrides per selling format for custom stacking configurations.`,
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
    content: `Settings (/settings): Central configuration hub organized into four groups.

GENERAL:
Account (/settings/account): Your personal profile and preferences.
System Settings (/settings/system): API keys (Anthropic for AI assistant), tax rates, compliance settings.
Brewery Settings (/settings/brewery): Brewery name, units of measurement, general preferences.
Users (/settings/users): Manage team members and roles.
Notifications (/settings/notifications): Configure notification preferences.
Integrations (/settings/integrations): Connect Square, Slack, QuickBooks, and other services.

CATALOGS:
Locations (/settings/locations): Warehouses, cold rooms, and storage areas used for inventory tracking.
Yeast Strains (/settings/yeasts): Manage yeast varieties with attenuation ranges, temperature ranges, and flocculation data.
Water Profiles (/settings/water-profiles): Define water chemistry profiles (calcium, magnesium, sulfate, chloride, etc.) for recipe formulation.
Beer Styles (/settings/beer-styles): BJCP style guidelines with OG, FG, ABV, IBU, and SRM ranges for style compliance checking.
Brands (/settings/brands): Manage your beer brands used across recipes, batches, and finished goods.

COMMERCE:
Package Formats (/settings/containers): Manage physical containers (cans, bottles, kegs) and their selling formats.
Selling Formats (/settings/selling-formats): Define how containers are sold (singles, 4-packs, cases, per keg). Each format can have a Bill of Materials (BOM) defining required packaging materials (cans, lids, PakTechs, trays, keg caps) and pallet configuration (units per layer, default layers). Whole-unit materials use a "[X] per [Y]" entry pattern (e.g., "1 tray per 24 cans"); bulk materials use a single decimal field. See "Bills of Materials" for details.
Shipping Defaults (/settings/shipping-defaults): Set brewery-wide default shipping materials (pallet type, wrap type) used when calculating order shipping needs.
Sales Channels (/settings/sales-channels): Categorize customers by channel (taproom, distribution, online) for pricing rules.
Pricing (/settings/pricing): Spreadsheet-style pricing matrix -- set prices by tier and selling format per sales channel.

ADMIN:
Status & Options (/settings/status-options): Manage lookup values and enum options used throughout the app.`,
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
 *
 * Markdown contract (audit F-053): `HelpSection.content` is now authored as
 * GitHub-flavored markdown. The string is forwarded verbatim — modern LLMs
 * read markdown natively, so bullets, bold, and inline links stay coherent
 * in the system prompt. Consumed by `getAppGuide` in
 * `src/app/api/chat/tools.ts`.
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
