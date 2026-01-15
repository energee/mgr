# MGR Implementation Plan

> Generated: January 2026
> Status: Active
> Last Updated: 2026-01-15

## Overview

This document tracks the implementation progress of MGR features based on the specification in `MGR-SPECIFICATION.md`. Items are organized by phase and priority.

## Legend

- [ ] Not started
- [~] In progress
- [x] Complete
- [!] Blocked

---

## Quick Reference: Key Patterns

### Entity Configuration Pattern
All entities follow the same structure. Reference: `src/entities/batch.tsx`

```typescript
export const entityEntity: EntityConfig<EntityType> = {
  // Identity
  name: "entity_name",
  table: "table_name",
  viewTable: "view_name",  // Optional: for computed fields
  displayName: "Entity",
  displayNamePlural: "Entities",
  description: "...",
  domain: "production" | "inventory" | "sales" | "purchasing",

  // List View
  listColumns: [...],
  listFilters: [...],
  defaultSort: { column: "...", direction: "asc" | "desc" },
  searchableFields: [...],

  // Detail View
  detailHeader: { title: "field", subtitle: "field", badge: "status_field" },
  detailSections: [...],

  // Form
  formSchema: zodSchema,
  formFields: [...],

  // State Machine (if applicable)
  stateMachine: { stateField, states, transitions, stateDisplay },
  actions: [...],

  // Relations
  relations: [...],

  // AI Context
  queryExamples: [...],
  keyFields: [...],
};
```

### Page Pattern
All entity pages use universal components. Reference: `src/app/(app)/production/batches/`

```
/[domain]/[entity-plural]/
  page.tsx         -> <EntityList entity={config} />
  new/page.tsx     -> <EntityForm entity={config} />
  [id]/page.tsx    -> <EntityDetail entity={config} id={id} />
  [id]/edit/page.tsx -> <EntityForm entity={config} id={id} />
```

### Migration Naming
Pattern: `00XXX_description.sql`
Current highest: `00023`
Next available: `00024`

### Reference Files by Pattern

| Pattern | Reference File |
|---------|----------------|
| Entity config with state machine | `src/entities/batch.tsx` |
| Entity config with viewTable | `src/entities/vessel.tsx` |
| Domain component (editor) | `src/components/domain/grain-bill-editor.tsx` |
| Entity pages | `src/app/(app)/production/batches/` |
| Catalog selector | `src/components/domain/hop-schedule-editor.tsx` |

---

## Phase 1: Schema Foundation

**Goal:** Establish core data model patterns that other features depend on.
**Timeline:** 1-2 weeks
**Status:** Complete (migrations applied, seed data created, UI components built)

### 1.1 Recipe Junction Tables (DEC-HP-002)

> Move recipe ingredients from JSONB arrays to proper junction tables for queryability.

- [x] Create migration `00011_catalog_and_recipe_junction.sql`
  - [x] Create all catalog tables (malts, hops, yeasts, adjuncts, sugars, spices, fruits, additives)
  - [x] Create beer_styles reference table
  - [x] Create water_profiles table
  - [x] Create `recipe_malts` table (recipe_id, malt_id, weight_lbs, position)
  - [x] Create `recipe_hops` table (recipe_id, hop_id, weight_oz, timing, boil_time_min, position)
  - [x] Create `recipe_adjuncts` table (recipe_id, adjunct_id, weight_lbs, timing, position)
  - [x] Create `recipe_sugars` table
  - [x] Create `recipe_spices` table
  - [x] Create `recipe_fruits` table
  - [x] Create `recipe_additions` table (water chemistry, clarifiers)
  - [x] Add foreign key constraints
  - [x] Add `_schema_registry` entries for new tables
  - [x] Update recipes table with new columns (style_id, yeast_id, water_profile_id, volumes in BBL, etc.)
- [x] Create `recipes_with_estimates` view with calculated OG, FG, ABV, IBU, SRM
- [x] Update recipe entity config to handle junction table relations
- [x] Create ingredient management UI components (grain bill editor, hop schedule editor)
  - [x] `src/components/domain/grain-bill-editor.tsx` - Malt selection and weight management
  - [x] `src/components/domain/hop-schedule-editor.tsx` - Hop timing, weight, and IBU calculation
- [ ] Create data migration script for existing JSONB data (if any)
- [ ] Remove deprecated JSONB columns after verification

### 1.2 Database Indexes (DEC-HP-004)

> Add performance indexes for common query patterns.

- [x] Create migration `00012_performance_indexes.sql`
  - [x] Batch status and date indexes
  - [x] Order fulfillment indexes (status, customer, dates)
  - [x] Vessel indexes (status, type, location)
  - [x] Vessel transfer indexes (critical for current_batch view)
  - [x] Brew log indexes
  - [x] Recipe indexes (style, brand, name)
  - [x] Inventory item indexes
  - [x] Brand and package type indexes
  - [x] Text search indexes (pg_trgm for fuzzy search)

### 1.3 Calculated Views (DEC-HP-005 / DEC-PERF-002)

> Create views for calculated fields; remove redundant stored fields.

- [x] Create `recipes_with_estimates` view (in 00011 migration)
  - [x] Calculate OG from grain bill (using PPG and efficiency)
  - [x] Calculate FG from OG and attenuation
  - [x] Calculate ABV from OG/FG (standard formula)
  - [x] Calculate IBU from hop schedule (Tinseth with timing-based utilization)
  - [x] Calculate SRM from grain bill (Morey equation)
  - [ ] Calculate COGS from ingredient costs (future enhancement)
- [x] Create `inventory_lots_with_quantities` view (migration 00014)
- [x] Create `finished_goods_with_availability` view (migration 00014)
- [x] Create `batches_with_brew_info` view (migration 00014)
  - [x] Join brew log data (actual OG, brew date)
- [x] Update recipe entity config to reference view data

---

## Phase 2: Production Workflow

**Goal:** Complete the recipe → batch → brew log → vessel workflow.
**Timeline:** 1-2 weeks
**Status:** Complete (2.1-2.4 done, brew log events UI complete)
**Depends On:** Phase 1

### 2.1 Vessel Entity

> Vessels (fermenters, brites, etc.) are critical for batch assignment.

- [x] Create `src/entities/vessel.tsx`
  - [x] Define vessel state machine (dirty → caustic_cleaned → ready_for_use → in_use → maintenance)
  - [x] Define list columns (name, type, capacity, status, current batch)
  - [x] Define form fields (name, type, capacity, location, notes)
  - [x] Define detail sections
- [x] Register vessel entity in `src/entities/index.ts`
- [x] Create vessel pages
  - [x] `src/app/(app)/production/vessels/page.tsx` (list)
  - [x] `src/app/(app)/production/vessels/[id]/page.tsx` (detail)
  - [x] `src/app/(app)/production/vessels/[id]/edit/page.tsx` (edit)
  - [x] `src/app/(app)/production/vessels/new/page.tsx` (create)
- [x] Add vessel selector to batch form (uses dynamicOptions from vessels table)
- [x] Use `vessels_with_batch` view (existed in migration 00006)
  - [x] Added `viewTable` support to EntityConfig
  - [x] Updated EntityList to use viewTable when available

### 2.2 Brew Log Pages

> Entity config exists; needs routes and pages.

- [x] Create brew log pages
  - [x] `src/app/(app)/production/brew-logs/page.tsx` (list)
  - [x] `src/app/(app)/production/brew-logs/[id]/page.tsx` (detail)
  - [x] `src/app/(app)/production/brew-logs/[id]/edit/page.tsx` (edit)
  - [x] `src/app/(app)/production/brew-logs/new/page.tsx` (create)
- [x] Implement brew log events UI
  - [x] Phase tracking (mash, lauter, boil, whirlpool, knockout)
  - [x] Metric recording (temps, gravities, pH)
  - [x] Timeline visualization
- [x] Add navigation from batch detail to linked brew logs (BrewLogLinker)

### 2.2.1 Batch Readings UI (Mobile-First)

> Record fermentation metrics - optimized for tablet/phone use on brewery floor.

- [x] Create `src/components/domain/batch-reading-form.tsx`
  - [x] Large touch-friendly input fields (48px min touch targets)
  - [x] Quick metric type selector (gravity, temp, pH, pressure, DO, diacetyl, clarity)
  - [x] Timestamp auto-fill with manual override
  - [x] Notes field for observations
  - [x] Real-time validation with warnings
- [x] Create `src/app/(app)/production/batches/[id]/readings/page.tsx`
  - [x] Mobile-optimized layout
  - [x] Quick-add button
  - [x] Recent readings list
  - [x] Current status summary (latest by type)
- [x] Create reading types and validation (`src/lib/batch-readings.ts`)
  - [x] `gravity`: SG or Plato with range validation
  - [x] `temperature`: °F or °C with fermentation range warnings
  - [x] `ph`: 0-14 range with style-appropriate warnings
  - [x] `pressure`: PSI for carbonation tracking
  - [x] `dissolved_oxygen`: ppb with threshold warnings
  - [x] `diacetyl`: present/absent/trace options
  - [x] `clarity`: scale options
- [x] Create readings chart visualization
  - [x] Gravity curve over time (with target FG line)
  - [x] Temperature profile (toggle between metrics)
  - [ ] Multi-metric overlay option (future enhancement)

### 2.2.2 Batch Additions UI

> Record additions during fermentation (dry hops, fruit, adjuncts).

- [x] Create `src/components/domain/batch-addition-form.tsx`
  - [x] Addition type selector (dry_hop, fruit, adjunct, fining, spice, other)
  - [x] Ingredient selector (from catalog with search, or free-text)
  - [x] Weight/quantity input with unit selection
  - [x] Timestamp and contact time (for dry hops)
  - [x] Notes field
- [x] Create `src/app/(app)/production/batches/[id]/additions/page.tsx`
  - [x] List of additions with timing
  - [x] Summary by type (total quantities)
  - [x] Chronological history view
- [x] Create addition types (`src/lib/batch-additions.ts`)
  - [x] Type-safe catalog queries for each addition type
  - [x] Unit options and defaults per type
- [x] Link additions to recipe expectations
  - [x] Show recipe's planned additions (PlannedAdditions component)
  - [x] Highlight completed vs pending additions
  - [ ] Calculate actual IBU contribution for dry hops (future)

### 2.3 Batch-Brew Log Linking

> Connect brews to batches via `brew_log_batches` junction.

- [x] Create UI for linking brew log to batch(es)
  - [x] `src/components/domain/brew-log-linker.tsx` - Links brew logs to batches
  - [x] Support split fermentation (1 brew → multiple batches)
  - [x] Track volume allocation per batch
- [x] Update batch detail to show linked brew data
  - [x] `src/components/domain/batch-brew-info.tsx` - Displays brew info on batch
  - [x] Display actual OG from brew log
  - [x] Display brew date
  - [x] Display brewer
- [x] Add "Start Fermentation" action to batch
  - [x] Prompt for vessel assignment (StartFermentationDialog)
  - [x] Create vessel transfer record (knockout from kettle)

### 2.4 Vessel Transfers

> Track batch movement through vessels.

- [x] Create vessel transfer entity config (`src/entities/vessel-transfer.tsx`)
- [x] Create vessel transfer pages
  - [x] `src/app/(app)/production/vessel-transfers/page.tsx` (list)
  - [x] `src/app/(app)/production/vessel-transfers/[id]/page.tsx` (detail)
  - [x] `src/app/(app)/production/vessel-transfers/new/page.tsx` (create)
- [x] Update vessel status based on transfers (automatic trigger - migration 00023)
- [x] Create vessel history view (via EntityDetail relation tabs - transfers_to)
- [x] Create batch history view (via EntityDetail relation tabs - vessel_transfers)

---

## Phase 2.5: Recipe Builder Completion

**Goal:** Complete the full recipe builder with all ingredient types, schedules, and water chemistry.
**Status:** Mostly Complete (ingredient editors, schedules, water chemistry, COGS done; recipe form integration pending)
**Depends On:** Phase 1

### 2.5.1 Additional Ingredient Editors

> Junction tables exist but need UI components similar to grain-bill-editor and hop-schedule-editor.

- [x] Create `src/components/domain/adjunct-editor.tsx`
  - [x] Searchable adjunct selector from catalog
  - [x] Timing selection (mash, boil, fermentation)
  - [x] Weight/quantity input
- [x] Create `src/components/domain/sugar-editor.tsx`
  - [x] Sugar type selection from catalog
  - [x] Weight input with PPG display
- [x] Create `src/components/domain/spice-editor.tsx`
  - [x] Spice/herb selection from catalog
  - [x] Timing and quantity with unit selection
  - [x] Boil time for boil additions
- [x] Create `src/components/domain/fruit-editor.tsx`
  - [x] Fruit selection from catalog
  - [x] Weight and timing
- [ ] Create `src/components/domain/additions-editor.tsx`
  - [ ] Water chemistry additions (gypsum, calcium chloride, etc.)
  - [ ] Clarifiers (whirlfloc, irish moss)
  - [ ] Nutrients

### 2.5.2 Mash Schedule Builder

> Multi-step mash with rest temps and times.

- [x] Create `src/components/domain/mash-schedule-editor.tsx`
  - [x] Add/remove/reorder mash steps
  - [x] Per-step: type, name, target temp, rest time
  - [x] Common presets (single infusion, step mash, hochkurz, decoction)
  - [x] Temperature reference guide
- [x] `mash_schedule` JSONB column exists in recipes table (migration 00017)
- [x] Display mash schedule in recipe detail view
- [ ] Water volume calculations per step (future)

### 2.5.3 Fermentation Schedule Builder

> Temperature ramps and dry hop timing.

- [x] Create `src/components/domain/fermentation-schedule-editor.tsx`
  - [x] Add/remove/reorder fermentation stages
  - [x] Per-stage: type, name, target temp, duration, notes
  - [x] Common presets (ale, lager, NEIPA, saison, belgian)
  - [x] Collapsible notes for dry hop timing, ramp instructions
- [x] `fermentation_schedule` JSONB column exists in recipes table (migration 00017)
- [x] Display fermentation schedule in recipe detail view

### 2.5.4 Water Chemistry Calculator

> Target water profile and additions calculation.

- [x] Create `src/components/domain/water-chemistry-calculator.tsx`
  - [x] Source water profile input (or select from saved profiles)
  - [x] Target water profile selection
  - [x] Auto-calculate additions needed (gypsum, CaCl2, etc.)
  - [x] Display sulfate:chloride ratio
  - [x] Mash pH estimation
- [x] Create `src/lib/water-chemistry.ts` with calculation functions
- [ ] Integrate with recipe form (link to water_profile_id and recipe_additions)

### 2.5.5 Recipe Templates

> Support for template recipes with variable ingredients.

- [x] Add `is_template` boolean column to recipes table (migration 00018)
- [x] Add UI toggle for template mode in recipe form
- [ ] Support null `ingredient_id` in junction tables for variable slots (future)
- [x] Create "Clone from Template" action
  - [x] Copy all recipe data (RecipeCloneDialog component)
  - [x] Prompt user to fill variable ingredient slots (via brand selection)
  - [x] Link to brand
- [x] Filter template recipes separately in list view
- [x] Add Clone action to recipe detail page

### 2.5.6 Recipe COGS Calculation

> Calculate estimated cost of goods sold.

- [x] Create `recipes_with_cogs` view (migration 00021)
  - [x] Sum ingredient costs from catalog (malts, hops, yeast, adjuncts)
  - [x] Calculate per-BBL cost
- [x] Display estimated COGS in recipe detail (`recipe-cogs-display.tsx`)
- [ ] Compare actual vs estimated COGS when batch completes

---

## Phase 3: Packaging & Inventory

**Goal:** Complete the batch → packaging → finished goods → inventory flow.
**Timeline:** 1-2 weeks
**Status:** Mostly Complete (entities and pages done, allocation workflow pending)
**Depends On:** Phase 2

### 3.1 Unified Allocations Table (DEC-HP-001)

> Merge `allocations` and `fg_allocations` into single polymorphic table.

- [ ] Create migration for unified `allocations` table structure
  - [ ] Migrate data from existing tables
  - [ ] Update all views that reference allocations
- [ ] Update inventory queries to use new structure
- [ ] Update AI query helpers

### 3.2 Packaging Session Entity

> Track packaging runs (kegging, canning, bottling).

- [x] Create `src/entities/packaging-session.tsx`
  - [x] Define state machine (planned → in_progress → completed → revised)
  - [x] Define list columns (date, batch, format, target quantity, status)
  - [x] Define form fields
- [x] Register packaging session entity
- [x] Create packaging session pages (`src/app/(app)/production/packaging/`)
- [x] Implement line items UI (multiple package formats per session)
  - [x] Create `src/entities/session-line-item.tsx` entity config
  - [x] Create `src/components/domain/session-line-items-editor.tsx` inline editor
  - [x] Create `src/components/domain/session-line-items-display.tsx` wrapper for detail view
  - [x] Integrate with packaging session detail view via custom component section

### 3.3 Finished Goods Entity

> Packaged inventory items.

- [x] Create `src/entities/finished-good.tsx`
  - [x] Define list columns (batch, brand, package type, quantity, location)
  - [x] Define detail sections
- [x] Register finished good entity
- [x] Create finished goods pages (`src/app/(app)/inventory/finished-goods/`)
- [ ] Link packaging session completion to FG creation

### 3.4 Inventory Allocation Workflow

> Allocate finished goods to orders.

- [x] Create allocation UI for orders (`order-allocation.tsx` with FIFO suggestion)
- [ ] Implement pick list generation
- [x] Update inventory quantities on allocation (via allocation records)
- [ ] Add approval workflow for allocations (optional)

---

## Phase 4: Sales & Purchasing

**Goal:** Complete order fulfillment and purchasing workflows.
**Timeline:** 1-2 weeks
**Status:** Mostly Complete (entities, pages, line items, receiving done; pricing tiers pending)
**Depends On:** Phase 3

### 4.1 Order Line Items

> Currently only order headers exist.

- [x] Create order items sub-entity config (`src/entities/order-item.tsx`)
- [x] Add line items UI to order form (`order-items-editor.tsx`)
- [x] Add line items display to order detail
- [x] Calculate order totals from line items

### 4.2 Supplier Entity

> Vendors for raw materials.

- [x] Create `src/entities/supplier.tsx`
- [x] Register supplier entity
- [x] Create supplier pages (`src/app/(app)/purchasing/suppliers/`)
- [ ] Link suppliers to inventory items

### 4.3 Purchase Order Entity

> Track orders to suppliers.

- [x] Create `src/entities/purchase-order.tsx`
  - [x] Define state machine (draft → submitted → confirmed → partially_received → received → closed)
  - [x] Define line items relation
- [x] Create PO line items sub-entity config (`src/entities/po-line-item.tsx`)
- [x] Register purchase order entity
- [x] Create purchase order pages (`src/app/(app)/purchasing/pos/`)
- [x] Implement PO line items UI (`po-line-items-editor.tsx`)

### 4.4 Receiving Workflow

> Convert PO receipts to inventory lots.

- [x] Create receiving UI (`po-receiving.tsx`)
- [x] Generate inventory lots from received items
- [x] Update PO status on receipt
- [x] Track partial receipts

### 4.5 Customer Entity

> Manage customer accounts.

- [x] Create `src/entities/customer.tsx`
  - [x] List columns: name, sales channel, balance, last order
  - [x] Form fields: name, contact, address, sales channel, notes
- [x] Create customer pages (`src/app/(app)/sales/customers/`)
- [ ] Customer balance tracking
  - [ ] Detail with order history, keg balance
- [ ] Link customer to sales channel for pricing

### 4.6 Sales Channel & Price Tiers

> Configure pricing by channel.

- [ ] Create `src/entities/sales-channel.tsx`
  - [ ] Types: distributor, retailer, taproom, export, etc.
- [ ] Create `src/entities/price-tier.tsx`
  - [ ] Link tier to sales channel
  - [ ] Per-brand or per-style pricing
- [ ] Create `src/entities/tier-price.tsx`
  - [ ] brand_id (optional), style_id (optional), format_id
  - [ ] Price per unit
- [ ] Create pricing management pages
  - [ ] Price tier list
  - [ ] Price matrix editor (brand × format grid)
- [ ] Implement price resolution logic
  - [ ] Customer → Sales Channel → Price Tier
  - [ ] Brand-specific price or fall back to style price

### 4.7 Order Pricing Integration

> Auto-price order lines from tiers.

- [ ] Look up customer's sales channel on line add
- [ ] Find tier price for brand + format
- [ ] Apply price with override option
- [ ] Display price source (tier name or "manual")

---

## Phase 5: Data Integrity & Audit

**Goal:** Improve data quality and audit capabilities.
**Timeline:** 1 week
**Status:** Partial (entity revisions and error handling complete)

### 5.1 Entity Revisions Table (DEC-MP-001)

> Unified audit trail for all entities.

- [x] Create migration for `entity_revisions` table (migration 00019)
- [x] Implement revision triggers for key entities (batches, recipes, orders)
- [x] Create revision history UI component (`revision-history.tsx`)
- [ ] Add revision history to entity details (integration pending)

### 5.2 Temporal Pricing (DEC-MP-003)

> Price history with effective dates.

- [ ] Add `valid_from`, `valid_to` to `tier_prices`
- [ ] Update pricing queries to respect date ranges
- [ ] Add price history UI

### 5.3 Enum Registry (DEC-MP-005)

> Centralized enum management.

- [ ] Create `enum_values` table
- [ ] Migrate hardcoded enums to table
- [ ] Create enum management UI (admin)

### 5.4 Optimistic Locking

> Prevent concurrent modification conflicts.

- [ ] Add `version` column to high-contention tables
  - [ ] `finished_goods`
  - [ ] `bin_inventory`
- [ ] Create `updateWithOptimisticLock` utility function
- [ ] Implement conflict detection in forms
- [ ] Create "Record modified" error dialog with refresh option

### 5.5 Error Handling Patterns

> Consistent error handling across the application.

- [x] Create `src/lib/errors.ts` with error types
  - [x] ValidationError, ConstraintError, ConcurrentModificationError, NotFoundError
  - [x] Map PostgreSQL error codes to user-friendly messages
- [x] Create constraint message mapping (POSTGRES_ERROR_MAP)
- [ ] Implement retry with exponential backoff for network errors
- [x] Create error boundary component for graceful failure (`src/components/ui/error-boundary.tsx`)
- [x] Add toast notifications for common error types (via sonner integration)

### 5.6 Row Level Security

> Ensure all tables have proper RLS policies.

- [ ] Audit existing RLS policies
- [ ] Create RLS policies for all tables based on roles
  - [ ] Admin: full access
  - [ ] Production Manager: production, inventory, purchasing
  - [ ] Brewer: recipes, batches, brew logs, vessels
  - [ ] Sales: orders, customers, pricing
- [ ] Test RLS policies with each role
- [ ] Document RLS policy patterns

---

## Phase 6: Integrations & Notifications

**Goal:** Connect to external systems.
**Timeline:** Ongoing
**Status:** Partial (Square done)

### 6.1 Square POS Integration

> Sync taproom POS transactions to debit inventory.

- [x] Basic webhook sync implemented
- [ ] Manual reconciliation UI
  - [ ] View unmapped Square items
  - [ ] Create item mappings (Square → MGR products)
  - [ ] Review sync errors
  - [ ] Manual adjustment for missed sales
- [ ] Automatic inventory sync on packaging
- [ ] Sales data import (historical)
- [ ] Reconciliation reports (Square vs MGR inventory)

### 6.2 Slack Notifications

> Real-time alerts to brewery Slack.

- [ ] Configure Slack webhook (stored encrypted)
- [ ] Create Supabase Edge Function for sending notifications
- [ ] Implement notification triggers
  - [ ] Low inventory alerts (below reorder point)
  - [ ] Order status changes (confirmed, ready to ship)
  - [ ] Batch state transitions (ready for packaging)
  - [ ] QC holds
  - [ ] PO delivery due
  - [ ] FG expiring soon
- [ ] Per-notification-type channel configuration
- [ ] Message formatting with attachments/links

### 6.3 QuickBooks Integration

> Sync invoices and bills to QuickBooks Online.

- [ ] OAuth 2.0 setup
  - [ ] Authorization flow
  - [ ] Token refresh handling
  - [ ] Encrypted token storage
- [ ] Customer sync (MGR → QBO)
  - [ ] Create customer on first order
  - [ ] Update customer details
- [ ] Invoice sync
  - [ ] Create invoice when order status = out_the_door
  - [ ] Line item mapping
  - [ ] Track qb_invoice_id on order
- [ ] Bill sync (optional)
  - [ ] Create bill when PO fulfilled
  - [ ] Supplier mapping
- [ ] Account mapping UI (which QBO accounts to use)
- [ ] Sync status dashboard

### 6.4 In-App Notifications

> Real-time notifications within MGR.

- [x] Create `notifications` table (migration 00020)
  - [x] user_id, type, title, message, entity_type, entity_id, priority, action_url, metadata
  - [x] read_at, dismissed_at timestamps
- [x] Implement Supabase Realtime subscription (NotificationsProvider context)
- [x] Create notification bell component in header
- [x] Notification dropdown with unread count
- [x] Mark as read functionality
- [x] Dismiss notification functionality
- [x] Create notification triggers (migration 00022)
  - [x] Batch status change notifications
  - [x] Order status change notifications
  - [x] New order notifications
  - [x] PO status change notifications
  - [x] Packaging session completion notifications
  - [x] check_low_inventory() function for periodic checks
- [ ] Notification list page for history
- [x] Notification preferences page (`settings/notifications/page.tsx`)
  - [x] Per-type enable/disable toggles
  - [x] Email digest frequency settings
  - [x] Quiet hours configuration

### 6.5 Email Notifications

> Email alerts for critical events.

- [ ] Set up email service (Resend or similar)
- [ ] Create email templates
  - [ ] Low inventory alert
  - [ ] Order confirmation
  - [ ] Weekly summary digest
- [ ] Respect user notification preferences
- [ ] Unsubscribe handling

---

## Phase 7: Reporting & Compliance

**Goal:** Business intelligence and regulatory compliance.
**Timeline:** 2-3 weeks
**Status:** Partially Started (TTB report UI created, dashboards pending)
**Depends On:** Phase 3 (allocations)

### 7.1 TTB Form 5130.9

> Brewer's Report of Operations

- [x] Create reports hub page (`src/app/(app)/reports/page.tsx`)
- [x] Create TTB report page (`src/app/(app)/reports/ttb/page.tsx`)
  - [x] Date range selection for reporting period
  - [x] Production data queries from batches
  - [x] Display production summary table
- [ ] Implement required calculations
  - [ ] Beginning/ending inventory by tax class
  - [ ] Production by tax class
  - [ ] Removals (taxable, tax-free, export)
  - [ ] Losses
- [ ] Add report export (PDF, CSV)

### 7.2 Production Dashboard

- [ ] Vessel utilization chart
- [ ] Batch status overview
- [ ] Upcoming brew schedule
- [ ] Fermentation tracking

### 7.3 Inventory Dashboard

- [ ] Low stock alerts
- [ ] Expiring lots
- [ ] Ingredient usage trends
- [ ] Reorder recommendations

### 7.4 Sales Dashboard

- [ ] Order pipeline
- [ ] Revenue by customer/channel
- [ ] Product mix analysis

---

## Phase 8: Settings & Administration

**Goal:** Complete system configuration, user management, and administrative functions.
**Status:** Partially Started (placeholder pages created for settings hub)
**Depends On:** None (can be done in parallel)

### 8.1 System Settings

> Brewery-wide configuration.

- [x] Create `src/app/(app)/settings/page.tsx` (settings hub)
- [x] Create `src/app/(app)/settings/brewery/page.tsx` (placeholder)
- [ ] Create `src/app/(app)/settings/system/page.tsx`
  - [ ] Brewery name, address, contact info
  - [ ] Default units (volume, weight, temperature, gravity)
  - [ ] Timezone settings
  - [ ] Tax rates (federal, state)
  - [ ] Fiscal year settings
- [ ] Create `system_settings` table for key-value config
- [ ] Create settings entity config and form

### 8.2 User Management

> Create, edit, and manage user accounts and roles.

- [x] Create `src/app/(app)/settings/users/page.tsx` (placeholder)
- [ ] Create `src/app/(app)/settings/users/[id]/page.tsx` (detail)
- [ ] Create `src/app/(app)/settings/users/[id]/edit/page.tsx` (edit)
- [ ] Create `src/app/(app)/settings/users/new/page.tsx` (invite)
- [ ] Create `src/entities/user.tsx`
  - [ ] List columns: name, email, roles, last active, status
  - [ ] Form fields: name, email, roles (multi-select)
  - [ ] Role assignment UI (Admin, Production Manager, Brewer, Sales)
- [ ] Implement user invitation flow (email invite)
- [ ] Implement avatar upload
- [ ] Implement password reset (admin-initiated)
- [ ] Add role-based access control checks to all entity operations

### 8.3 Location Management

> Warehouses, taproom, production areas.

- [x] Create `src/app/(app)/settings/locations/page.tsx` (placeholder)
- [ ] Create `src/app/(app)/settings/locations/[id]/page.tsx` (detail)
- [ ] Create `src/app/(app)/settings/locations/new/page.tsx` (create)
- [ ] Create `src/entities/location.tsx`
  - [ ] Types: warehouse, taproom, production, cold_storage, external
  - [ ] Address fields
  - [ ] Default for certain operations flag
- [ ] Link locations to bins, vessels, finished goods

### 8.4 Integration Settings

> OAuth connections and API configuration.

- [x] Create `src/app/(app)/settings/integrations/page.tsx` (placeholder)
- [ ] Square integration settings
  - [ ] OAuth connection flow
  - [ ] Location mapping
  - [ ] Item mapping UI (Square items → MGR products)
  - [ ] Sync status and error log viewer
- [ ] QuickBooks integration settings
  - [ ] OAuth connection flow
  - [ ] Account mapping
  - [ ] Sync preferences
- [ ] Slack integration settings
  - [ ] Webhook URL configuration
  - [ ] Channel mapping per notification type
  - [ ] Test notification button

### 8.5 Notification Preferences

> Per-user notification settings.

- [x] Create `src/app/(app)/settings/notifications/page.tsx` (placeholder)
- [ ] Create `notification_preferences` table
- [ ] Per-notification-type settings:
  - [ ] In-app toggle
  - [ ] Email toggle
  - [ ] Slack toggle (if user has Slack)
- [ ] Notification types: low_inventory, batch_ready, order_due, po_delivery, packaging_scheduled, fg_expiring

### 8.6 Reference Data Management

> Manage package formats, keg types, sales channels.

- [ ] Create `src/app/(app)/settings/formats/page.tsx`
  - [ ] Package types (12oz can, 16oz can, 1/6 BBL, 1/2 BBL, etc.)
  - [ ] Volume, unit count per case
- [ ] Create `src/app/(app)/settings/keg-types/page.tsx`
  - [ ] Keg sizes and deposit amounts
  - [ ] Lifecycle states
- [ ] Create `src/app/(app)/settings/sales-channels/page.tsx`
  - [ ] Distribution, retail, taproom, export, etc.
  - [ ] Link to price tiers

---

## Phase 9: Yeast Management

**Goal:** Track yeast inventory, pitches, harvests, and lineage.
**Status:** Not Started
**Depends On:** Phase 2 (Batches)

### 9.1 Yeast Strain Catalog

> Reference data for yeast strains.

- [ ] Verify `yeasts` catalog table exists with proper fields
- [ ] Create `src/entities/yeast-strain.tsx`
- [ ] Create yeast catalog management pages
  - [ ] List with filtering by lab, type
  - [ ] Detail with typical parameters (temp range, attenuation, flocculation)

### 9.2 Yeast Pitch Tracking

> Track individual pitches from purchase through repitching.

- [ ] Create migration for `yeast_pitches` table
  - [ ] source_type: purchase, harvest
  - [ ] strain_id, generation, viability
  - [ ] parent_pitch_id (for lineage)
  - [ ] cost, date_received
- [ ] Create `src/entities/yeast-pitch.tsx`
- [ ] Create yeast pitch pages
  - [ ] List: strain, generation, viability, status
  - [ ] Detail: lineage tree, usage history
  - [ ] Create: new purchase or harvest

### 9.3 Yeast Harvest Recording

> Record harvests from batches.

- [ ] Create harvest recording UI
  - [ ] Link to source batch
  - [ ] Volume harvested, cell count estimate
  - [ ] Auto-increment generation
  - [ ] Calculate viability decay
- [ ] Create `yeast_harvests` table or extend pitches
- [ ] Link harvest to new pitch record

### 9.4 Yeast Viability Calculation

> Auto-calculate viability decay over time.

- [ ] Create `src/lib/yeast-calculations.ts`
  - [ ] Viability decay formula (typically ~2-4% per day)
  - [ ] Cell count estimation
  - [ ] Pitching rate calculator (cells/mL/°P)
- [ ] Display current estimated viability on pitch records
- [ ] Warn when viability below threshold

### 9.5 Yeast Cost Spreading

> Spread yeast cost across all batches in lineage.

- [ ] Create yeast lineage cost calculation
  - [ ] Original cost / total batches using that lineage
  - [ ] Update COGS calculations to include yeast cost
- [ ] Display cost-per-batch in lineage view

---

## Phase 10: Keg Management

**Goal:** Track keg inventory, lifecycle, and customer balances.
**Status:** Not Started
**Depends On:** Phase 4 (Sales)

### 10.1 Keg Type Configuration

> Define keg sizes and lifecycle states.

- [ ] Create/verify `keg_types` table
  - [ ] Size (1/6 BBL, 1/2 BBL, 50L, etc.)
  - [ ] Volume in BBL
  - [ ] Deposit amount
  - [ ] Lifecycle states configuration
- [ ] Create keg type management UI in Settings

### 10.2 Keg Inventory

> Track individual kegs or keg quantities by state.

- [ ] Create `kegs` or `keg_inventory` table
  - [ ] keg_type_id, state, location_id
  - [ ] Optional: individual keg tracking with serial numbers
  - [ ] Batch/content tracking when filled
- [ ] Create `src/entities/keg.tsx`
- [ ] Create keg inventory pages
  - [ ] List: by type, state, location
  - [ ] Summary view: counts by type/state

### 10.3 Keg State Transitions

> Record keg lifecycle events.

- [ ] Create `keg_transactions` table
  - [ ] transaction_type: fill, ship, return, clean, receive, adjust
  - [ ] keg_type_id, quantity
  - [ ] from_state, to_state
  - [ ] related entity (order, batch, customer)
- [ ] Create state transition recording UI
- [ ] Auto-create transactions from packaging sessions (fill)
- [ ] Auto-create transactions from order shipments (ship)

### 10.4 Customer Keg Balances

> Track kegs out with customers.

- [ ] Create `customer_keg_balances` view or table
  - [ ] Kegs shipped minus kegs returned per customer
  - [ ] By keg type
- [ ] Add keg balance display to customer detail
- [ ] Create keg return recording UI
- [ ] Keg deposit tracking (optional: integrate with invoicing)

### 10.5 Keg Reports

- [ ] Keg inventory summary by state
- [ ] Kegs out by customer
- [ ] Keg turnover rate
- [ ] Aging kegs (out too long)

---

## Phase 11: Unit System & Preferences

**Goal:** Implement user-configurable unit display and conversion.
**Status:** Partial (conversion library, user preferences, and UnitInput component complete)
**Depends On:** Phase 8.1 (System Settings)

### 11.1 Conversion Library

> Pure functions for unit conversion.

- [x] Create `src/lib/units.ts`
  - [x] Volume: BBL ↔ gal ↔ L ↔ hL
  - [x] Weight: lbs ↔ kg
  - [x] Temperature: °F ↔ °C
  - [x] Gravity: Plato ↔ SG
  - [x] Retail volume: oz ↔ mL
- [x] Never round during conversion (round at display only)

### 11.2 User Preferences

> Per-user unit preferences.

- [x] Create/extend `user_preferences` table (migration 00009)
  - [x] volume_unit, weight_unit, temperature_unit, gravity_unit
- [x] Create `src/hooks/useUnitPreferences.ts` (React Query hook)
- [ ] Add unit preferences to user settings page

### 11.3 Unit Input Component

> Input field with optional unit switcher.

- [x] Create `src/components/ui/unit-input.tsx`
  - [x] Accept canonical value (always BBL, lbs, etc.)
  - [x] Display in user's preferred unit
  - [x] Convert on input back to canonical
  - [x] Optional inline unit switcher for recipe builder
- [ ] Create `src/components/ui/unit-display.tsx` for read-only display

### 11.4 Integration

- [ ] Update recipe form to use UnitInput
- [ ] Update brew log forms to use UnitInput
- [ ] Update batch forms to use UnitInput
- [ ] Reports always show canonical units (BBL for TTB compliance)

---

## Phase 12: API Routes & Backend

**Goal:** Implement REST API endpoints for all entities with proper auth, validation, and error handling.
**Status:** Not Started
**Depends On:** Phase 5.5 (Error Handling)

### 12.1 API Infrastructure

> Common patterns and utilities for all API routes.

- [ ] Create `src/lib/api/response.ts`
  - [ ] Standard success response format: `{ data: T, meta?: { page, per_page, total } }`
  - [ ] Standard error response format: `{ error: { code, message, details } }`
  - [ ] Helper functions: `success()`, `error()`, `paginated()`
- [ ] Create `src/lib/api/auth.ts`
  - [ ] `withAuth()` wrapper for protected routes
  - [ ] `withRoles(roles[])` wrapper for role-based access
  - [ ] Extract user and roles from Supabase session
- [ ] Create `src/lib/api/validation.ts`
  - [ ] Request body validation with Zod
  - [ ] Query parameter parsing and validation
  - [ ] File upload validation
- [ ] Create `src/lib/api/errors.ts`
  - [ ] API-specific error classes
  - [ ] PostgreSQL error code mapping
  - [ ] Constraint violation messages

### 12.2 Production API Routes

> Batches, brew logs, vessels, recipes.

- [ ] `app/api/batches/route.ts` (GET list, POST create)
- [ ] `app/api/batches/[id]/route.ts` (GET, PATCH, DELETE)
- [ ] `app/api/batches/[id]/readings/route.ts` (GET, POST)
- [ ] `app/api/batches/[id]/additions/route.ts` (GET, POST)
- [ ] `app/api/batches/[id]/transfer/route.ts` (POST - vessel transfer)
- [ ] `app/api/recipes/route.ts` (GET, POST)
- [ ] `app/api/recipes/[id]/route.ts` (GET, PATCH, DELETE)
- [ ] `app/api/recipes/[id]/clone/route.ts` (POST - clone recipe)
- [ ] `app/api/brew-logs/route.ts` (GET, POST)
- [ ] `app/api/brew-logs/[id]/route.ts` (GET, PATCH, DELETE)
- [ ] `app/api/vessels/route.ts` (GET, POST)
- [ ] `app/api/vessels/[id]/route.ts` (GET, PATCH, DELETE)

### 12.3 Packaging & Inventory API Routes

- [ ] `app/api/packaging/sessions/route.ts` (GET, POST)
- [ ] `app/api/packaging/sessions/[id]/route.ts` (GET, PATCH, DELETE)
- [ ] `app/api/packaging/sessions/[id]/complete/route.ts` (POST - finalize)
- [ ] `app/api/inventory/finished-goods/route.ts` (GET, POST)
- [ ] `app/api/inventory/bins/route.ts` (GET, POST)
- [ ] `app/api/inventory/transfers/route.ts` (GET, POST)
- [ ] `app/api/inventory/kegs/route.ts` (GET, POST)

### 12.4 Sales & Orders API Routes

- [ ] `app/api/orders/route.ts` (GET, POST)
- [ ] `app/api/orders/[id]/route.ts` (GET, PATCH, DELETE)
- [ ] `app/api/orders/[id]/items/route.ts` (GET, POST, DELETE)
- [ ] `app/api/orders/[id]/allocate/route.ts` (POST - allocate FG)
- [ ] `app/api/orders/[id]/fulfill/route.ts` (POST - mark shipped)
- [ ] `app/api/customers/route.ts` (GET, POST)
- [ ] `app/api/customers/[id]/route.ts` (GET, PATCH, DELETE)

### 12.5 Purchasing API Routes

- [ ] `app/api/purchasing/pos/route.ts` (GET, POST)
- [ ] `app/api/purchasing/pos/[id]/route.ts` (GET, PATCH, DELETE)
- [ ] `app/api/purchasing/pos/[id]/receive/route.ts` (POST - receive items)
- [ ] `app/api/purchasing/generate/route.ts` (POST - auto-generate POs)
- [ ] `app/api/suppliers/route.ts` (GET, POST)
- [ ] `app/api/suppliers/[id]/route.ts` (GET, PATCH, DELETE)

### 12.6 Reports API Routes

- [ ] `app/api/reports/ttb/route.ts` (GET - TTB 5130.9 data)
- [ ] `app/api/reports/projections/route.ts` (GET - ingredient projections)
- [ ] `app/api/reports/cogs/route.ts` (GET - cost of goods sold)
- [ ] `app/api/reports/inventory/route.ts` (GET - inventory summary)

### 12.7 Webhook Routes

- [ ] `app/api/webhooks/square/route.ts` (POST - Square POS events)
- [ ] `app/api/webhooks/qbo/route.ts` (POST - QuickBooks events)
- [ ] Webhook signature verification
- [ ] Idempotency handling

---

## Phase 13: AI Integration Implementation

**Goal:** Implement AI-first features including database functions, TypeScript utilities, and schema context.
**Status:** Partial (database functions and TypeScript utilities implemented)
**Depends On:** Phase 1 (Schema)

### 13.1 Schema Registry Population

> Ensure all tables have comprehensive AI context in `_schema_registry`.

- [ ] Audit existing `_schema_registry` entries
- [ ] Add missing tables to registry
- [ ] Populate `key_fields` for all tables
- [ ] Populate `query_examples` with natural language examples
- [ ] Populate `ai_context` with domain-specific guidance
- [ ] Add `calculated_fields` for views
- [ ] Document state machines in registry

### 13.2 Database Functions for AI

> PostgreSQL functions that AI agents can call for analysis.
> Note: All functions implemented in migration 00008_ai_integration.sql

- [x] Create `analyze_recipe_style_compliance(recipe_id UUID)`
  - [x] Compare recipe estimates to BJCP style guidelines
  - [x] Return compliance status for OG, FG, ABV, IBU, SRM
  - [x] Include suggestions for adjustments
- [x] Create `get_recipe_summary(recipe_id UUID)`
  - [x] Return comprehensive recipe data in structured JSON
  - [x] Include all ingredients, schedules, estimates
  - [x] Include style information
- [x] Create `suggest_recipe_improvements(recipe_id UUID)`
  - [x] Analyze grain bill balance
  - [x] Check hop schedule timing
  - [x] Verify water chemistry for style
  - [x] Return prioritized suggestions
- [x] Create `analyze_batch_performance(batch_id UUID)`
  - [x] Compare actual vs target metrics
  - [x] Calculate efficiency variance
  - [x] Identify potential issues
- [x] Create `get_inventory_overview()`
  - [x] Current FG by brand/format
  - [x] Low stock alerts
  - [x] Expiring soon alerts
- [x] Create `get_ai_schema_context(domain TEXT)`
  - [x] Return schema info for specified domain
  - [x] Include relationships and examples

### 13.3 TypeScript AI Utilities

> Client-side utilities in `src/lib/ai/` for AI-assisted features.
> Note: Core utilities implemented in `src/lib/ai/`

- [x] Create `src/lib/ai/index.ts` (barrel export)
- [x] Create `src/lib/ai/recipe-analysis.ts` (named recipe-analyzer.ts)
  - [x] `analyzeStyleCompliance(recipeId)` - call DB function
  - [x] `getRecipeSummary(recipeId)` - call DB function
  - [x] `getRecipeSuggestions(recipeId)` - call DB function
- [x] Create `src/lib/ai/calculations.ts` (in recipe-analyzer.ts)
  - [x] `BrewingCalculations` class with OG, FG, ABV, IBU, SRM formulas
  - [x] `WaterChemistry` class with ion calculations
  - [x] `FermentationAnalysis` class with timeline predictions
- [x] Create `src/lib/ai/schema-context.ts`
  - [x] `getSchemaContext(domain)` - fetch from registry
  - [x] `getDomainSummary()` - high-level overview
  - [x] `getValidTransitions(entity, currentState)` - state machine helper
- [x] Create `src/lib/ai/query-helpers.ts`
  - [x] `AIQueryHelpers` class with common query patterns
  - [ ] Natural language to SQL hints
  - [ ] Query template library

### 13.4 AI-Enhanced UI Components

> UI components that leverage AI analysis.

- [ ] Create `src/components/ai/recipe-analyzer.tsx`
  - [ ] Display style compliance results
  - [ ] Show improvement suggestions
  - [ ] Interactive "what-if" adjustments
- [ ] Create `src/components/ai/batch-insights.tsx`
  - [ ] Performance vs target visualization
  - [ ] Fermentation predictions
  - [ ] Issue detection alerts
- [ ] Create `src/components/ai/inventory-alerts.tsx`
  - [ ] Smart reorder recommendations
  - [ ] Demand forecasting display
  - [ ] Expiration warnings

### 13.5 Entity Config AI Enhancements

> Add AI context to all entity configurations.

- [x] Add `queryExamples` to all entities (15 entities have queryExamples)
  - [x] Natural language query examples
  - [x] Common question patterns
- [x] Add `keyFields` to all entities (15 entities have keyFields)
  - [ ] Fields most relevant for AI queries
  - [ ] Search/filter priority fields
- [ ] Add `aiActions` to relevant entities
  - [ ] Available AI-assisted actions
  - [ ] Analysis function mappings

---

## Phase 14: Advanced Workflows

**Goal:** Implement complex business workflows that span multiple entities.
**Status:** Not Started
**Depends On:** Phase 3, Phase 4

### 14.1 Batch Blending

> Combine multiple batches into a single batch.

- [ ] Create `blend_batches` table
  - [ ] blend_id (new batch), source_batch_id, volume_bbl
- [ ] Create blending UI
  - [ ] Select source batches
  - [ ] Specify volumes from each
  - [ ] Calculate blended estimates (OG, ABV, IBU weighted by volume)
- [ ] Create allocation records for source batches
- [ ] Update source batch remaining volumes
- [ ] Link blended batch to all source recipes

### 14.2 PO Generation from Demand

> Auto-generate purchase orders from planned production.

- [ ] Create `src/lib/purchasing/demand-calculator.ts`
  - [ ] Calculate ingredient needs from planned batches
  - [ ] Factor in current inventory levels
  - [ ] Apply lead times per supplier
  - [ ] Group shortfalls by supplier
- [ ] Create `src/lib/purchasing/po-generator.ts`
  - [ ] Generate draft POs from shortfalls
  - [ ] Apply preferred suppliers
  - [ ] Respect minimum order quantities
- [ ] Create ingredient projections UI
  - [ ] Timeline view of ingredient needs
  - [ ] Shortfall highlighting
  - [ ] One-click PO generation
- [ ] Create `app/api/purchasing/generate/route.ts`
  - [ ] Accept date range and options
  - [ ] Return generated PO drafts

### 14.3 Pick List Generation

> Generate warehouse pick lists for order fulfillment.

- [ ] Create `pick_lists` table
  - [ ] order_id, status (pending, in_progress, completed)
  - [ ] generated_at, picked_at, picker_id
- [ ] Create `pick_list_items` table
  - [ ] pick_list_id, finished_good_id, bin_id
  - [ ] quantity, picked_quantity
- [ ] Create pick list generation logic
  - [ ] FIFO allocation (oldest FG first)
  - [ ] Bin location optimization (minimize travel)
  - [ ] Split handling for partial bins
- [ ] Create pick list UI
  - [ ] Mobile-optimized for warehouse tablet
  - [ ] Scan-to-pick support (barcode)
  - [ ] Quantity confirmation
  - [ ] Variance recording

### 14.4 Landed Cost Calculation

> Calculate true cost of received inventory including shipping.

- [ ] Add `shipping_cost` to PO receipts
- [ ] Create landed cost calculation
  - [ ] Allocate shipping across line items by weight or value
  - [ ] Calculate per-unit landed cost
  - [ ] Store on inventory lot record
- [ ] Update COGS calculations to use landed cost
- [ ] Display landed cost in inventory views

### 14.5 Batch Cancellation Workflow

> Handle batch cancellation with proper cleanup.

- [ ] Create cancellation dialog
  - [ ] Reason code selection (quality, equipment, other)
  - [ ] Loss quantity recording
  - [ ] Notes field
- [ ] Implement cancellation logic
  - [ ] Create loss allocation record
  - [ ] Release vessel assignment
  - [ ] Update inventory if materials consumed
  - [ ] Trigger notifications
- [ ] Create cancellation audit trail

---

## Phase 15: Testing & Quality

**Goal:** Comprehensive testing strategy with automated CI/CD.
**Status:** Not Started
**Depends On:** All phases (parallel work)

### 15.1 Unit Testing

> Test pure functions and calculations.

- [ ] Set up Vitest configuration
- [ ] Create `src/lib/__tests__/` structure
- [ ] Test brewing calculations
  - [ ] OG calculation from grain bill
  - [ ] IBU calculation (Tinseth formula)
  - [ ] SRM calculation (Morey equation)
  - [ ] ABV calculation
- [ ] Test unit conversions
  - [ ] Volume conversions (BBL ↔ gal ↔ L)
  - [ ] Weight conversions (lbs ↔ kg)
  - [ ] Temperature conversions (°F ↔ °C)
  - [ ] Gravity conversions (SG ↔ Plato)
- [ ] Test allocation calculations
  - [ ] Available quantity calculation
  - [ ] FIFO allocation logic
- [ ] Test water chemistry calculations
  - [ ] Ion contribution from additions
  - [ ] Sulfate:chloride ratio
- [ ] Test yeast viability decay
- [ ] Target: 90%+ coverage for `src/lib/`

### 15.2 Integration Testing

> Test database operations and API routes.

- [ ] Set up test database (Supabase local or test project)
- [ ] Create test fixtures and factories
- [ ] Test state machine transitions
  - [ ] Batch state transitions
  - [ ] Order state transitions
  - [ ] PO state transitions
  - [ ] Vessel state transitions
- [ ] Test allocation workflows
  - [ ] FG allocation to orders
  - [ ] Inventory lot allocation to batches
- [ ] Test API routes
  - [ ] Auth middleware
  - [ ] CRUD operations
  - [ ] Error responses
- [ ] Test RLS policies
  - [ ] Per-role access verification
  - [ ] Cross-role isolation

### 15.3 E2E Testing

> Test critical user workflows.

- [ ] Set up Playwright configuration
- [ ] Create test user accounts per role
- [ ] Test production workflow
  - [ ] Create recipe → create batch → record brew log → record readings → package
- [ ] Test order fulfillment workflow
  - [ ] Create order → allocate FG → generate pick list → fulfill
- [ ] Test purchasing workflow
  - [ ] Create PO → submit → receive → verify lots created
- [ ] Test authentication flows
  - [ ] Login, logout, session expiry
  - [ ] Role-based UI visibility

### 15.4 CI/CD Pipeline

> Automated testing and deployment.

- [ ] Create `.github/workflows/test.yml`
  - [ ] Run unit tests on PR
  - [ ] Run integration tests on PR
  - [ ] Type checking
  - [ ] Linting
- [ ] Create `.github/workflows/e2e.yml`
  - [ ] Run E2E tests on main branch
  - [ ] Screenshot on failure
- [ ] Create `.github/workflows/deploy.yml`
  - [ ] Deploy to Vercel on main
  - [ ] Run migrations on deploy
- [ ] Set up test coverage reporting
- [ ] Add status badges to README

### 15.5 Database Testing

> Test migrations and seed data.

- [ ] Create migration test script
  - [ ] Apply migrations to fresh database
  - [ ] Verify schema matches expected
  - [ ] Test rollback procedures
- [ ] Create seed data for development
  - [ ] Sample recipes (various styles)
  - [ ] Sample batches (various states)
  - [ ] Sample orders and customers
  - [ ] Sample inventory
- [ ] Create data validation scripts
  - [ ] Referential integrity checks
  - [ ] State consistency checks

---

## Quick Wins (Can Be Done Anytime)

These are low-effort improvements that can be tackled between phases.

### UI/UX Improvements

- [ ] Add bulk status change to batch list
- [ ] Add quick filters to all entity lists
- [ ] Add keyboard shortcuts for common actions
- [ ] Add empty states with helpful prompts
- [ ] Add loading skeletons to all pages

### Entity Config Enhancements

- [x] Add `queryExamples` to all entities for AI (15 entities)
- [x] Add `keyFields` to all entities for AI (15 entities)
- [x] Ensure all entities have proper `description` (all entities have description field)
- [ ] Add computed columns where useful

### Developer Experience

- [ ] Add Storybook stories for universal components
- [ ] Add integration tests for critical workflows
- [ ] Document API patterns
- [ ] Add database seed data for development

---

## Notes

### Decision References

All major decisions reference the specification document:
- `DEC-HP-*` = High Priority decisions (Section 2B)
- `DEC-MP-*` = Medium Priority decisions (Section 2B)
- `DEC-PERF-*` = Performance decisions (Section 2C)
- `DEC-AI-*` = AI Integration decisions (Section 2A)

### Migration Naming

Migrations follow the pattern: `00XXX_description.sql`
- Current: 00001-00023
- Next available: 00024

### Testing Strategy

See **Phase 15: Testing & Quality** for comprehensive testing plan including:
- Unit tests for calculations (brewing formulas, allocations)
- Integration tests for state machine transitions
- E2E tests for critical workflows (order → fulfillment)
- CI/CD pipeline with automated testing

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-11 | Fixed recipe entity: enabled viewTable for recipes_with_estimates, added dynamicOptions for brand/style/yeast/water_profile selects |
| 2026-01-11 | Updated Phase 11 and 13 status to Partial based on existing code (units.ts, src/lib/ai/) |
| 2026-01-11 | Created expanded implementation plan docs in feature/implementation-plan branch |
| 2026-01-11 | Added Phase 2.2.1-2.2.2: Batch readings UI (mobile-first), batch additions UI with variance tracking |
| 2026-01-11 | Added Phase 12 (API Routes): Full REST API with auth, validation, error handling for all entities |
| 2026-01-11 | Added Phase 13 (AI Implementation): Schema registry, database functions, TypeScript utilities, AI components |
| 2026-01-11 | Added Phase 14 (Advanced Workflows): Blending, PO generation from demand, pick lists, landed cost, batch cancellation |
| 2026-01-11 | Added Phase 15 (Testing & Quality): Unit/integration/E2E tests, CI/CD pipeline, database testing |
| 2026-01-11 | Added Phase 2.5 (Recipe Builder): mash schedule, fermentation schedule, water chemistry, additional ingredient editors, templates |
| 2026-01-11 | Added Phase 8 (Settings): system settings, user management, locations, integrations, notifications, reference data |
| 2026-01-11 | Added Phase 9 (Yeast Management): pitch tracking, lineage, viability, cost spreading |
| 2026-01-11 | Added Phase 10 (Keg Management): inventory, lifecycle tracking, customer balances |
| 2026-01-11 | Added Phase 11 (Unit System): conversion library, user preferences, unit input components |
| 2026-01-11 | Expanded Phase 4: customer entity, sales channels, price tiers, order pricing |
| 2026-01-11 | Expanded Phase 5: optimistic locking, error handling patterns, RLS policies |
| 2026-01-11 | Expanded Phase 6: detailed Square reconciliation, QuickBooks, Slack, in-app, email notifications |
| 2026-01-11 | Phase 2 progress: Vessel entity, vessel pages, brew log pages, dynamic options support |
| 2026-01-11 | Phase 1 complete: migrations applied, seed data for catalogs, ingredient UI components |
| 2026-01-11 | Phase 1 migrations created: catalog tables, recipe junction tables, performance indexes |
| 2026-01-11 | Initial plan created based on spec review |
| 2026-01-13 | Consolidated expanded files into single plan, added Quick Reference and Appendices |
| 2026-01-14 | Phase 6.4: Added notification triggers migration (00022) for batch, order, PO status changes |
| 2026-01-14 | Phase 2.4: Added vessel transfer trigger (00023), completed vessel/batch history views via relation tabs |
| 2026-01-14 | Phase 2.3: Added StartFermentationDialog with vessel selection and transfer creation |
| 2026-01-14 | Phase 2.2.1: Added BatchReadingsChart with gravity/temperature visualization using shadcn charts |
| 2026-01-14 | Phase 2.1: Added navigation from batch to brew logs in BrewLogLinker component |
| 2026-01-14 | Phase 2.2.2: Added PlannedAdditions component showing recipe additions with completion tracking |
| 2026-01-15 | Phase 2.5.2-2.5.3: Added mash and fermentation schedule display to recipe detail view |
| 2026-01-15 | Phase 2.5.5: Added Clone action to recipe detail page via RecipeCloneDialog |
| 2026-01-15 | Verified Phase 1.3: All calculated views exist in migration 00014 |
| 2026-01-15 | Verified Phase 2.5.4: Water chemistry calculator and library complete |
| 2026-01-15 | Verified Phase 2.5.6: Recipe COGS view and display component complete |
| 2026-01-15 | Verified Phase 4.1: Order line items UI complete (order-items-editor.tsx) |
| 2026-01-15 | Verified Phase 4.3: PO line items UI complete (po-line-items-editor.tsx) |
| 2026-01-15 | Verified Phase 4.4: Receiving workflow complete (po-receiving.tsx) |
| 2026-01-15 | Verified Phase 3.4: Order allocation UI complete (order-allocation.tsx) |
| 2026-01-15 | Verified Phase 5.1: Entity revisions migration and UI component complete |
| 2026-01-15 | Verified Phase 5.5: Error handling patterns with error types and PostgreSQL mapping |
| 2026-01-15 | Verified Phase 6.4: Notification preferences page complete with per-type toggles |
| 2026-01-15 | Verified Phase 11.2: User preferences table and hook complete |
| 2026-01-15 | Verified Phase 11.3: UnitInput component with unit conversion complete |

---

## Appendix A: File Reference Index

### Entity Configurations
```
src/entities/
├── batch.tsx              # State machine, viewTable example
├── brew-log.tsx           # Events array, custom detail components
├── customer.tsx           # Simple entity without state machine
├── finished-good.tsx      # Read-only entity
├── inventory-item.tsx     # Category-based display config
├── order.tsx              # Complex state machine
├── order-item.tsx         # Line item entity
├── packaging-session.tsx  # Production state machine
├── po-line-item.tsx       # Purchase order line items
├── purchase-order.tsx     # Purchasing workflow
├── recipe.tsx             # Many relations, junction tables
├── supplier.tsx           # Purchasing domain
├── vessel.tsx             # viewTable with joins
├── vessel-transfer.tsx    # Production tracking
└── index.ts               # Entity registry
```

### Universal Components
```
src/components/universal/
├── entity-list.tsx        # TanStack Table, filtering, sorting
├── entity-detail.tsx      # Sections, state machine display
├── entity-form.tsx        # Zod validation, dynamic options
└── status-badge.tsx       # Status display with colors
```

### Domain Components
```
src/components/domain/
├── app-header.tsx         # User menu
├── app-sidebar.tsx        # Navigation structure
├── grain-bill-editor.tsx  # Catalog selector pattern
├── hop-schedule-editor.tsx # Timing-based editor
├── order-items-editor.tsx # Order line items
├── po-line-items-editor.tsx # PO line items
├── po-receiving.tsx       # Receiving workflow
└── recipe-analysis.tsx    # Recipe AI analysis
```

### Libraries
```
src/lib/
├── units.ts               # Unit conversion (complete)
├── utils.ts               # General utilities
├── supabase/
│   ├── client.ts          # Browser client
│   └── server.ts          # Server client
└── ai/
    ├── index.ts           # AI exports
    ├── query-helpers.ts   # Common queries
    ├── recipe-analyzer.ts # Style compliance
    └── schema-context.ts  # Schema introspection
```

### Migrations
```
supabase/migrations/
├── 00001_initial_schema.sql
├── 00002_single_tenant.sql
├── 00003_brands.sql
├── 00004_brew_logs.sql
├── 00005_batches_cleanup.sql
├── 00006_vessels.sql
├── 00007_vessel_types_foeder_barrel.sql
├── 00008_ai_integration.sql
├── 00009_user_preferences_and_units.sql
├── 00010_unified_allocations.sql
├── 00011_catalog_and_recipe_junction.sql
├── 00012_performance_indexes.sql
├── 00013_rls_performance_fix.sql
├── 00014_security_fixes.sql
├── 00015-00018 (various fixes)
├── 00019_entity_revisions.sql
├── 00020_notifications.sql
├── 00021_recipe_cogs.sql
├── 00022_notification_triggers.sql
└── 00023_vessel_transfer_trigger.sql
```

---

## Appendix B: Completion Checklist Template

For each implementation task, verify:

### [Task Name]

#### Files Created/Modified
- [ ] File path 1
- [ ] File path 2

#### Database Changes
- [ ] Migration created and applied
- [ ] Types regenerated (`pnpm supabase gen types`)

#### Functionality
- [ ] Feature works as specified
- [ ] Edge cases handled
- [ ] Error messages user-friendly

#### Testing
- [ ] Manual testing completed
- [ ] Unit tests written (if applicable)
- [ ] E2E test written (if applicable)

#### Code Quality
- [ ] TypeScript compiles without errors
- [ ] ESLint passes
- [ ] No console.logs in production code
- [ ] Follows existing patterns

---

*Document consolidated January 2026*
