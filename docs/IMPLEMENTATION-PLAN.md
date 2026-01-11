# MGR Implementation Plan

> Generated: January 2026
> Status: Active
> Last Updated: 2026-01-11

## Overview

This document tracks the implementation progress of MGR features based on the specification in `MGR-SPECIFICATION.md`. Items are organized by phase and priority.

## Legend

- [ ] Not started
- [~] In progress
- [x] Complete
- [!] Blocked

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
- [ ] Create `inventory_lots_with_quantities` view (in 00010 - pending commit)
- [ ] Create `finished_goods_with_availability` view (in 00010 - pending commit)
- [ ] Create `batches_with_brew_info` view
  - [ ] Join brew log data (actual OG, brew date)
- [x] Update recipe entity config to reference view data

---

## Phase 2: Production Workflow

**Goal:** Complete the recipe → batch → brew log → vessel workflow.
**Timeline:** 1-2 weeks
**Status:** In Progress (2.1, 2.2 core pages complete)
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
- [ ] Implement brew log events UI
  - [ ] Phase tracking (mash, lauter, boil, whirlpool, knockout)
  - [ ] Metric recording (temps, gravities, pH)
  - [ ] Timeline visualization
- [ ] Add navigation from batch detail to linked brew logs

### 2.2.1 Batch Readings UI (Mobile-First)

> Record fermentation metrics - optimized for tablet/phone use on brewery floor.

- [ ] Create `src/components/domain/batch-reading-form.tsx`
  - [ ] Large touch-friendly input fields
  - [ ] Quick metric type selector (gravity, temp, pH, pressure, DO, diacetyl, clarity)
  - [ ] Timestamp auto-fill with manual override
  - [ ] Notes field for observations
- [ ] Create `src/app/(app)/production/batches/[id]/readings/page.tsx`
  - [ ] Mobile-optimized layout
  - [ ] Quick-add floating action button
  - [ ] Recent readings list with inline editing
- [ ] Create reading types and validation
  - [ ] `gravity`: SG or Plato with auto-convert
  - [ ] `temperature`: °F or °C with fermentation range warnings
  - [ ] `ph`: 0-14 range with style-appropriate warnings
  - [ ] `pressure`: PSI for carbonation tracking
  - [ ] `dissolved_oxygen`: ppb with threshold warnings
  - [ ] `diacetyl`: present/absent/trace with VDK rest reminder
  - [ ] `clarity`: scale 1-5 or turbidity NTU
- [ ] Create readings chart visualization
  - [ ] Gravity curve over time (with target FG line)
  - [ ] Temperature profile (with fermentation schedule overlay)
  - [ ] Multi-metric overlay option

### 2.2.2 Batch Additions UI

> Record additions during fermentation (dry hops, fruit, adjuncts).

- [ ] Create `src/components/domain/batch-addition-form.tsx`
  - [ ] Addition type selector (dry_hop, fruit, adjunct, fining, other)
  - [ ] Ingredient selector (from catalog or free-text)
  - [ ] Weight/quantity input with unit conversion
  - [ ] Timestamp and duration (for dry hops: contact time)
  - [ ] Notes field
- [ ] Create `src/app/(app)/production/batches/[id]/additions/page.tsx`
  - [ ] List of additions with timing
  - [ ] Quick-add from recipe's planned additions
  - [ ] Variance tracking (planned vs actual)
- [ ] Link additions to recipe expectations
  - [ ] Show recipe's dry hop schedule
  - [ ] Highlight deviations from plan
  - [ ] Calculate actual IBU contribution for dry hops

### 2.3 Batch-Brew Log Linking

> Connect brews to batches via `brew_log_batches` junction.

- [ ] Create UI for linking brew log to batch(es)
  - [ ] Support split fermentation (1 brew → multiple batches)
  - [ ] Track volume allocation per batch
- [ ] Update batch detail to show linked brew data
  - [ ] Display actual OG from brew log
  - [ ] Display brew date
  - [ ] Display brewer
- [ ] Add "Start Fermentation" action to batch
  - [ ] Prompt for vessel assignment
  - [ ] Create vessel transfer record

### 2.4 Vessel Transfers

> Track batch movement through vessels.

- [ ] Create vessel transfer recording UI
- [ ] Update vessel status based on transfers
- [ ] Create vessel history view (what batches have used this vessel)
- [ ] Create batch history view (what vessels has this batch used)

---

## Phase 2.5: Recipe Builder Completion

**Goal:** Complete the full recipe builder with all ingredient types, schedules, and water chemistry.
**Status:** Not Started
**Depends On:** Phase 1

### 2.5.1 Additional Ingredient Editors

> Junction tables exist but need UI components similar to grain-bill-editor and hop-schedule-editor.

- [ ] Create `src/components/domain/adjunct-editor.tsx`
  - [ ] Searchable adjunct selector from catalog
  - [ ] Timing selection (mash, boil, fermentation)
  - [ ] Weight/quantity input
- [ ] Create `src/components/domain/sugar-editor.tsx`
  - [ ] Sugar type selection from catalog
  - [ ] Weight input with gravity contribution calculation
- [ ] Create `src/components/domain/spice-editor.tsx`
  - [ ] Spice/herb selection from catalog
  - [ ] Timing and quantity
- [ ] Create `src/components/domain/fruit-editor.tsx`
  - [ ] Fruit selection from catalog
  - [ ] Weight and timing
- [ ] Create `src/components/domain/additions-editor.tsx`
  - [ ] Water chemistry additions (gypsum, calcium chloride, etc.)
  - [ ] Clarifiers (whirlfloc, irish moss)
  - [ ] Nutrients

### 2.5.2 Mash Schedule Builder

> Multi-step mash with rest temps and times.

- [ ] Create `src/components/domain/mash-schedule-editor.tsx`
  - [ ] Add/remove/reorder mash steps
  - [ ] Per-step: name, target temp, rest time
  - [ ] Common presets (single infusion, step mash, decoction)
  - [ ] Water volume calculations per step
- [ ] Add `mash_schedule` JSONB column to recipes table (or create `recipe_mash_steps` junction)
- [ ] Display mash schedule in recipe detail view

### 2.5.3 Fermentation Schedule Builder

> Temperature ramps and dry hop timing.

- [ ] Create `src/components/domain/fermentation-schedule-editor.tsx`
  - [ ] Add/remove/reorder fermentation steps
  - [ ] Per-step: name, target temp, duration, notes
  - [ ] Dry hop timing integration (link to hop schedule dry_hop entries)
  - [ ] Cold crash and conditioning steps
- [ ] Add `fermentation_schedule` JSONB column to recipes table (or create `recipe_fermentation_steps` junction)
- [ ] Display fermentation schedule in recipe detail view

### 2.5.4 Water Chemistry Calculator

> Target water profile and additions calculation.

- [ ] Create `src/components/domain/water-chemistry-calculator.tsx`
  - [ ] Source water profile input (or select from saved profiles)
  - [ ] Target water profile selection
  - [ ] Auto-calculate additions needed (gypsum, CaCl2, etc.)
  - [ ] Display sulfate:chloride ratio
  - [ ] Mash pH estimation
- [ ] Create `src/lib/water-chemistry.ts` with calculation functions
- [ ] Integrate with recipe form (link to water_profile_id and recipe_additions)

### 2.5.5 Recipe Templates

> Support for template recipes with variable ingredients.

- [ ] Add `is_template` boolean column to recipes table
- [ ] Add UI toggle for template mode in recipe form
- [ ] Support null `ingredient_id` in junction tables for variable slots
- [ ] Create "Clone from Template" action
  - [ ] Copy all recipe data
  - [ ] Prompt user to fill variable ingredient slots
  - [ ] Link to brand
- [ ] Filter template recipes separately in list view

### 2.5.6 Recipe COGS Calculation

> Calculate estimated cost of goods sold.

- [ ] Create `recipes_with_cogs` view or add to `recipes_with_estimates`
  - [ ] Sum ingredient costs from catalog (malts, hops, yeast, adjuncts)
  - [ ] Factor in typical usage rates
- [ ] Display estimated COGS in recipe detail
- [ ] Compare actual vs estimated COGS when batch completes

---

## Phase 3: Packaging & Inventory

**Goal:** Complete the batch → packaging → finished goods → inventory flow.
**Timeline:** 1-2 weeks
**Status:** Not Started
**Depends On:** Phase 2

### 3.1 Unified Allocations Table (DEC-HP-001)

> Merge `allocations` and `fg_allocations` into single polymorphic table.

- [ ] Create migration `00012_unified_allocations.sql`
  - [ ] Create new unified `allocations` table structure
  - [ ] Migrate data from existing tables
  - [ ] Drop old tables
  - [ ] Update all views that reference allocations
- [ ] Update inventory queries to use new structure
- [ ] Update AI query helpers

### 3.2 Packaging Session Entity

> Track packaging runs (kegging, canning, bottling).

- [ ] Create `src/entities/packaging-session.tsx`
  - [ ] Define state machine (planned → in_progress → completed → revised)
  - [ ] Define list columns (date, batch, format, target quantity, status)
  - [ ] Define form fields
  - [ ] Define line items relation
- [ ] Register packaging session entity
- [ ] Create packaging session pages
- [ ] Implement line items UI (multiple package formats per session)

### 3.3 Finished Goods Entity

> Packaged inventory items.

- [ ] Create `src/entities/finished-good.tsx`
  - [ ] Define list columns (batch, brand, package type, quantity, location)
  - [ ] Define detail sections
- [ ] Register finished good entity
- [ ] Create finished goods pages
- [ ] Link packaging session completion to FG creation

### 3.4 Inventory Allocation Workflow

> Allocate finished goods to orders.

- [ ] Create allocation UI for orders
- [ ] Implement pick list generation
- [ ] Update inventory quantities on allocation
- [ ] Add approval workflow for allocations (optional)

---

## Phase 4: Sales & Purchasing

**Goal:** Complete order fulfillment and purchasing workflows.
**Timeline:** 1-2 weeks
**Status:** Not Started
**Depends On:** Phase 3

### 4.1 Order Line Items

> Currently only order headers exist.

- [ ] Create `order_items` table (if not exists)
- [ ] Create order items sub-entity config
- [ ] Add line items UI to order form
- [ ] Add line items display to order detail
- [ ] Calculate order totals from line items

### 4.2 Supplier Entity

> Vendors for raw materials.

- [ ] Create `src/entities/supplier.tsx`
- [ ] Register supplier entity
- [ ] Create supplier pages
- [ ] Link suppliers to inventory items

### 4.3 Purchase Order Entity

> Track orders to suppliers.

- [ ] Create `src/entities/purchase-order.tsx`
  - [ ] Define state machine (draft → submitted → partial → received → closed)
  - [ ] Define line items relation
- [ ] Register purchase order entity
- [ ] Create purchase order pages
- [ ] Implement PO line items UI

### 4.4 Receiving Workflow

> Convert PO receipts to inventory lots.

- [ ] Create receiving UI
- [ ] Generate inventory lots from received items
- [ ] Update PO status on receipt
- [ ] Track partial receipts

### 4.5 Customer Entity

> Manage customer accounts.

- [ ] Create `src/entities/customer.tsx`
  - [ ] List columns: name, sales channel, balance, last order
  - [ ] Form fields: name, contact, address, sales channel, notes
- [ ] Create customer pages
  - [ ] List with filtering by sales channel
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
**Status:** Not Started

### 5.1 Entity Revisions Table (DEC-MP-001)

> Unified audit trail for all entities.

- [ ] Create migration for `entity_revisions` table
- [ ] Implement revision triggers for key entities
- [ ] Create revision history UI component
- [ ] Add revision history to entity details

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

- [ ] Create `src/lib/errors.ts` with error types
  - [ ] ValidationError, ConstraintError, ConcurrentModificationError
  - [ ] Map PostgreSQL error codes to user-friendly messages
- [ ] Create constraint message mapping (chk_quantity_positive, etc.)
- [ ] Implement retry with exponential backoff for network errors
- [ ] Create error boundary component for graceful failure
- [ ] Add toast notifications for common error types

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

- [ ] Create `notifications` table
  - [ ] user_id, type, title, message, data, read_at
- [ ] Implement Supabase Realtime subscription
- [ ] Create notification bell component in header
- [ ] Notification dropdown with unread count
- [ ] Mark as read functionality
- [ ] Notification list page for history

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
**Status:** Not Started
**Depends On:** Phase 3 (allocations)

### 7.1 TTB Form 5130.9

> Brewer's Report of Operations

- [ ] Implement required calculations
  - [ ] Beginning/ending inventory by tax class
  - [ ] Production by tax class
  - [ ] Removals (taxable, tax-free, export)
  - [ ] Losses
- [ ] Create TTB report generation UI
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
**Status:** Not Started
**Depends On:** None (can be done in parallel)

### 8.1 System Settings

> Brewery-wide configuration.

- [ ] Create `src/app/(app)/settings/page.tsx` (settings hub)
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

- [ ] Create `src/app/(app)/settings/users/page.tsx` (list)
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

- [ ] Create `src/app/(app)/settings/locations/page.tsx` (list)
- [ ] Create `src/app/(app)/settings/locations/[id]/page.tsx` (detail)
- [ ] Create `src/app/(app)/settings/locations/new/page.tsx` (create)
- [ ] Create `src/entities/location.tsx`
  - [ ] Types: warehouse, taproom, production, cold_storage, external
  - [ ] Address fields
  - [ ] Default for certain operations flag
- [ ] Link locations to bins, vessels, finished goods

### 8.4 Integration Settings

> OAuth connections and API configuration.

- [ ] Create `src/app/(app)/settings/integrations/page.tsx`
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

- [ ] Create `src/app/(app)/settings/notifications/page.tsx`
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
**Status:** Not Started
**Depends On:** Phase 8.1 (System Settings)

### 11.1 Conversion Library

> Pure functions for unit conversion.

- [ ] Create `src/lib/units.ts`
  - [ ] Volume: BBL ↔ gal ↔ L ↔ hL
  - [ ] Weight: lbs ↔ kg
  - [ ] Temperature: °F ↔ °C
  - [ ] Gravity: Plato ↔ SG
  - [ ] Retail volume: oz ↔ mL
- [ ] Never round during conversion (round at display only)

### 11.2 User Preferences

> Per-user unit preferences.

- [ ] Create/extend `user_preferences` table
  - [ ] volume_unit, weight_unit, temperature_unit, gravity_unit
- [ ] Create `src/hooks/useUnitPreferences.ts` (React Query hook)
- [ ] Add unit preferences to user settings page

### 11.3 Unit Input Component

> Input field with optional unit switcher.

- [ ] Create `src/components/ui/unit-input.tsx`
  - [ ] Accept canonical value (always BBL, lbs, etc.)
  - [ ] Display in user's preferred unit
  - [ ] Convert on input back to canonical
  - [ ] Optional inline unit switcher for recipe builder
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
**Status:** Not Started
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

- [ ] Create `analyze_recipe_style_compliance(recipe_id UUID)`
  - [ ] Compare recipe estimates to BJCP style guidelines
  - [ ] Return compliance status for OG, FG, ABV, IBU, SRM
  - [ ] Include suggestions for adjustments
- [ ] Create `get_recipe_summary(recipe_id UUID)`
  - [ ] Return comprehensive recipe data in structured JSON
  - [ ] Include all ingredients, schedules, estimates
  - [ ] Include style information
- [ ] Create `suggest_recipe_improvements(recipe_id UUID)`
  - [ ] Analyze grain bill balance
  - [ ] Check hop schedule timing
  - [ ] Verify water chemistry for style
  - [ ] Return prioritized suggestions
- [ ] Create `analyze_batch_performance(batch_id UUID)`
  - [ ] Compare actual vs target metrics
  - [ ] Calculate efficiency variance
  - [ ] Identify potential issues
- [ ] Create `get_inventory_overview()`
  - [ ] Current FG by brand/format
  - [ ] Low stock alerts
  - [ ] Expiring soon alerts
- [ ] Create `get_ai_schema_context(domain TEXT)`
  - [ ] Return schema info for specified domain
  - [ ] Include relationships and examples

### 13.3 TypeScript AI Utilities

> Client-side utilities in `src/lib/ai/` for AI-assisted features.

- [ ] Create `src/lib/ai/index.ts` (barrel export)
- [ ] Create `src/lib/ai/recipe-analysis.ts`
  - [ ] `analyzeStyleCompliance(recipeId)` - call DB function
  - [ ] `getRecipeSummary(recipeId)` - call DB function
  - [ ] `getRecipeSuggestions(recipeId)` - call DB function
- [ ] Create `src/lib/ai/calculations.ts`
  - [ ] `BrewingCalculations` class with OG, FG, ABV, IBU, SRM formulas
  - [ ] `WaterChemistry` class with ion calculations
  - [ ] `FermentationAnalysis` class with timeline predictions
- [ ] Create `src/lib/ai/schema-context.ts`
  - [ ] `getSchemaContext(domain)` - fetch from registry
  - [ ] `getDomainSummary()` - high-level overview
  - [ ] `getValidTransitions(entity, currentState)` - state machine helper
- [ ] Create `src/lib/ai/query-helpers.ts`
  - [ ] `AIQueryHelpers` class with common query patterns
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

- [ ] Add `queryExamples` to all entities
  - [ ] Natural language query examples
  - [ ] Common question patterns
- [ ] Add `keyFields` to all entities
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

- [ ] Add `queryExamples` to all entities for AI
- [ ] Add `keyFields` to all entities for AI
- [ ] Ensure all entities have proper `description`
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
- Current: 00001-00012
- Next available: 00013

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
