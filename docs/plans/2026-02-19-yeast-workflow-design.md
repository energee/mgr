# Yeast Workflow Unification Design

**Date:** 2026-02-19
**Branch:** yeast
**Status:** Approved

## Problem

The yeast management system has solid foundations (entity configs, calculations library, lineage tracking, harvest dialog) but the pieces don't connect end-to-end. Key gaps:

1. **Pitch-to-batch workflow is broken** — "Use for Batch" action just flips status without linking to a batch
2. **1:1 model doesn't match reality** — one brink (harvest) serves multiple batches with partial deductions
3. **Batch actions are monolithic** — "Start Fermentation" bundles vessel transfer + state change into one abstract button
4. **No brink vessel type** — harvested yeast has no vessel representation
5. **Cell counts lack precision** — billion is too coarse; need thousand-cell resolution for rates like 400K cells/mL/°P

## Design Decisions

### Action-Driven Batch State Transitions

Replace monolithic batch actions with granular, real-world operations:

- **Transfer** — move beer between vessels (replaces "Start Fermentation" and "Move to Conditioning")
- **Pitch Yeast** — add yeast from a brink/purchase to a batch
- **Harvest Yeast** — collect yeast from a batch into a brink

State transitions are **suggested after actions** rather than triggered by abstract buttons:
- Transfer to fermenter → toast: "Mark batch as fermenting?" [Yes] [Not yet]
- Transfer to brite → toast: "Mark batch as conditioning?" [Yes] [Not yet]
- Pitch yeast on planned batch → toast: "Mark batch as fermenting?" [Yes] [Not yet]

Batch states remain unchanged: planned → fermenting → conditioning → packaging → completed.

### Pitch Events Model

Introduce `yeast_pitch_events` to support partial deductions from brinks:

```
yeast_pitches (brink/source)          yeast_pitch_events (usage)
┌─────────────────────────┐           ┌──────────────────────────┐
│ id                      │──────────→│ pitch_id (source)        │
│ strain_id               │           │ batch_id (target)        │
│ quantity_lbs             │           │ quantity_lbs             │
│ cell_count_thousand      │           │ cells_pitched_thousand   │
│ initial_viability        │           │ viability_at_pitch       │
│ vessel_id (brink)        │           │ pitched_at               │
│ status                   │           └──────────────────────────┘
│ generation               │           (one per batch pitched)
└─────────────────────────┘
```

- **Quantity remaining** = `quantity_lbs - SUM(events.quantity_lbs)` (calculated via view, never mutable)
- Supports multiple batches from one brink AND multiple pitches into one batch
- Follows existing project pattern: "quantities calculated via views, never stored as mutable balances"

### Brink as Vessel Type

Add `brink` to the `vessel_type` PostgreSQL enum. Brinks get all vessel features: capacity, status, location, scheduling.

### Cell Count Unit: Thousands

All cell counts stored in **thousands** throughout. Display formatting adapts:
- Large counts: "450M cells" (450,000 thousand)
- Pitch rates: "750K cells/mL/°P" (750 thousand)
- Precise rates: "400K cells/mL/°P" (400 thousand)

## Data Model Changes

### New Table: `yeast_pitch_events`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | |
| `pitch_id` | UUID FK → yeast_pitches | Source brink/purchase |
| `batch_id` | UUID FK → batches | Target batch |
| `quantity_lbs` | DECIMAL(10,2) | Weight pitched |
| `cells_pitched_thousand` | DECIMAL(14,2) | Cells pitched in thousands |
| `viability_at_pitch` | DECIMAL(5,2) | Measured/estimated viability at time of pitch |
| `pitched_at` | TIMESTAMPTZ | When pitched |
| `notes` | TEXT | |
| `created_by` | UUID FK → auth.users | |
| `created_at` | TIMESTAMPTZ | |

RLS: authenticated access. Indexes on `pitch_id`, `batch_id`.

### Modifications to `yeast_pitches`

| Change | Details |
|--------|---------|
| Add `quantity_lbs` | DECIMAL(10,2) — total weight |
| Add `cell_density` | DECIMAL(14,2) — thousand cells per lb |
| Add `vessel_id` | UUID FK → vessels — the brink this lives in |
| Rename `cell_count_billion` → `cell_count_thousand` | DECIMAL(14,2) — thousand cells |
| Remove `batch_id` | Moves to `yeast_pitch_events` |
| Remove `pitched_at` | Moves to `yeast_pitch_events` |
| Keep `volume_ml` | Still useful for liquid purchases before brink storage |

### New View: `yeast_pitches_with_remaining`

Replaces `yeast_pitches_with_details`. Adds:
- `quantity_remaining_lbs` = `quantity_lbs - COALESCE(SUM(events.quantity_lbs), 0)`
- `batches_pitched` = count of distinct batches from events
- Retains all existing calculated fields: `days_old`, `estimated_viability`, `viability_status`

### New View: `batch_yeast_summary`

For batch detail page — all yeast activity for a batch:
- Pitched: strain name, generation, quantity_lbs, cells_pitched, viability, pitched_at, source pitch link
- Harvested: strain name, generation, quantity_lbs, viability, brink vessel link

### Vessel Type Enum

```sql
ALTER TYPE vessel_type ADD VALUE 'brink';
```

### Retire `start_batch_fermentation()` Function

Replaced by separate Transfer + status update operations.

## UI Changes

### Batch Entity Config

**New Actions:**
- **Transfer** — available from planned, fermenting, conditioning. Opens vessel transfer dialog.
- **Pitch Yeast** — available from planned, fermenting. Opens new PitchYeastDialog.
- **Harvest Yeast** — available from fermenting, conditioning. Opens updated YeastHarvestDialog.

**Removed Actions:**
- ~~Start Fermentation~~ (replaced by Transfer + Pitch)
- ~~Move to Conditioning~~ (replaced by Transfer)

**New Section:**
- Yeast section showing pitched yeast table + harvested yeast table + recipe yeast context

### PitchYeastDialog (New Component)

Flow:
1. Select yeast source (brink or purchase) — filtered by in_stock, quantity > 0, recipe strains highlighted
2. Enter/confirm viability — pre-filled from decay estimate, editable after measurement
3. Calculate pitch rate — batch volume (BBL) × OG (°P) × rate (thousand cells/mL/°P) = cells needed → lbs needed
4. Confirm quantity — pre-filled from calculation, shows remaining after pitch
5. Submit — creates `yeast_pitch_event`, suggests state transition

### YeastHarvestDialog (Updated)

- Moves from yeast pitch detail page → batch detail page
- Targets a brink vessel instead of a location
- Uses weight (lbs) instead of volume (mL)
- Cell counts in thousands
- Lineage auto-linked via parent_pitch_id to the pitch event(s) that went into this batch

### TransferDialog (Updated)

- Smart state suggestion after completion based on destination vessel type
- Available from planned state (not just fermenting)

### Yeast Pitch Detail Page (Revised)

**Sections:** Pitch Info, Vessel (brink), Inventory (total/remaining lbs), Viability, Usage History (events table), Cost, Lineage, Notes

**Actions:**
- Pitch to Batch (opens PitchYeastDialog pre-selecting this pitch)
- Record Cell Count (quick dialog to update viability from measurement)
- Discard

### Vessel Entity Config

- Add `brink` to vessel type options

### yeast-calculations.ts

- Update all functions to use thousands as base unit
- Add weight-based pitch quantity calculation
- Existing functions preserved: viability decay, generation limits, harvest estimation

## What Stays the Same

- Yeast strain catalog (settings/yeasts) — no changes
- `YeastSelector` for recipes — no changes
- `YeastLineageDisplay` — works as-is (lineage model via parent_pitch_id unchanged)
- Lineage cost spreading — same recursive CTE pattern
- Generation auto-increment trigger — unchanged
- Viability decay algorithm — same math, new unit
- Batch states — unchanged (planned → fermenting → conditioning → packaging → completed)

## Not In Scope (Future Work)

- Dashboard yeast health metrics (low viability warnings, expiring pitches)
- Viability/expiration notification triggers
- Purchase order → yeast pitch auto-creation
- Strain-level inventory aggregation view
