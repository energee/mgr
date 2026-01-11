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
**Status:** Not Started
**Depends On:** Phase 1

### 2.1 Vessel Entity

> Vessels (fermenters, brites, etc.) are critical for batch assignment.

- [ ] Create `src/entities/vessel.tsx`
  - [ ] Define vessel state machine (dirty → cleaned → ready → in_use → dirty)
  - [ ] Define list columns (name, type, capacity, status, current batch)
  - [ ] Define form fields (name, type, capacity, location, notes)
  - [ ] Define detail sections
- [ ] Register vessel entity in `src/entities/index.ts`
- [ ] Create vessel pages
  - [ ] `src/app/(app)/production/vessels/page.tsx` (list)
  - [ ] `src/app/(app)/production/vessels/[id]/page.tsx` (detail)
  - [ ] `src/app/(app)/production/vessels/[id]/edit/page.tsx` (edit)
  - [ ] `src/app/(app)/production/vessels/new/page.tsx` (create)
- [ ] Add vessel selector to batch form
- [ ] Create `vessels_with_current_batch` view

### 2.2 Brew Log Pages

> Entity config exists; needs routes and pages.

- [ ] Create brew log pages
  - [ ] `src/app/(app)/production/brew-logs/page.tsx` (list)
  - [ ] `src/app/(app)/production/brew-logs/[id]/page.tsx` (detail)
  - [ ] `src/app/(app)/production/brew-logs/[id]/edit/page.tsx` (edit)
  - [ ] `src/app/(app)/production/brew-logs/new/page.tsx` (create)
- [ ] Implement brew log events UI
  - [ ] Phase tracking (mash, lauter, boil, whirlpool, knockout)
  - [ ] Metric recording (temps, gravities, pH)
  - [ ] Timeline visualization
- [ ] Add navigation from batch detail to linked brew logs

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

---

## Phase 6: Integrations & Notifications

**Goal:** Connect to external systems.
**Timeline:** Ongoing
**Status:** Partial (Square done)

### 6.1 Square POS Integration

- [x] Basic sync implemented
- [ ] Automatic inventory sync on packaging
- [ ] Sales data import
- [ ] Reconciliation reports

### 6.2 Slack Notifications

- [ ] Configure Slack webhook
- [ ] Implement notification triggers
  - [ ] Low inventory alerts
  - [ ] Order status changes
  - [ ] Batch state transitions
  - [ ] QC holds
- [ ] User notification preferences

### 6.3 QuickBooks Integration

- [ ] OAuth setup
- [ ] Invoice sync
- [ ] COGS tracking
- [ ] Financial reporting

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

- Unit tests for calculations (brewing formulas, allocations)
- Integration tests for state machine transitions
- E2E tests for critical workflows (order → fulfillment)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-11 | Phase 1 complete: migrations applied, seed data for catalogs, ingredient UI components |
| 2026-01-11 | Phase 1 migrations created: catalog tables, recipe junction tables, performance indexes |
| 2026-01-11 | Initial plan created based on spec review |
