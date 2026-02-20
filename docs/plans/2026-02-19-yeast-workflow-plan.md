# Yeast Workflow Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify yeast pitch management with batch workflows — action-driven state transitions, partial pitch deductions from brinks, and weight-based tracking with thousand-cell precision.

**Architecture:** Introduce `yeast_pitch_events` table for immutable pitch-to-batch deductions. Add `brink` vessel type. Replace monolithic batch actions (Start Fermentation, Move to Conditioning) with granular Transfer + Pitch Yeast + Harvest actions that suggest state transitions.

**Tech Stack:** PostgreSQL migrations, TypeScript entity configs, React dialogs, Zod validation, React Query, Supabase client.

**Worktree:** `/Users/tedslesinski/Repos/mgr/.worktrees/yeast/`
**Branch:** `yeast`
**Design Doc:** `docs/plans/2026-02-19-yeast-workflow-design.md`

---

## Task Dependency Graph

```
Task 1 (Migration) ──→ Task 3 (Vessel config)
       │              ├─→ Task 4 (Yeast pitch config)
       │              ├─→ Task 6 (PitchYeastDialog)
       │              ├─→ Task 7 (HarvestDialog)
       │              ├─→ Task 8 (TransferDialog)
       │              └─→ Task 9 (Batch config + page)
Task 2 (Calculations) ──→ Task 6 (PitchYeastDialog)
Task 5 (Query Keys) ──→ Task 6, 7, 9, 10
Tasks 6-8 ──→ Task 9 (Batch config + page)
Task 4 ──→ Task 10 (Yeast pitch detail page)
```

**Parallelizable:** Tasks 2, 3, 4, 5 can run in parallel after Task 1.

---

### Task 1: Database Migration — Schema Changes

**Files:**
- Create: `supabase/migrations/00095_yeast_workflow_unification.sql`

**Step 1: Write the migration**

```sql
-- Migration: Yeast Workflow Unification
-- Description: Add brink vessel type, yeast_pitch_events table,
-- modify yeast_pitches for weight-based tracking with thousand-cell precision.

-- =============================================================================
-- 1. Add 'brink' to vessel_type enum
-- =============================================================================
ALTER TYPE vessel_type ADD VALUE IF NOT EXISTS 'brink';

-- =============================================================================
-- 2. Modify yeast_pitches table
-- =============================================================================

-- Add new columns
ALTER TABLE yeast_pitches
  ADD COLUMN IF NOT EXISTS quantity_lbs DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS cell_density_thousand DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS vessel_id UUID REFERENCES vessels(id);

-- Rename cell_count_billion to cell_count_thousand
ALTER TABLE yeast_pitches
  RENAME COLUMN cell_count_billion TO cell_count_thousand;

-- Migrate existing data: convert billion to thousand (multiply by 1,000,000)
UPDATE yeast_pitches
SET cell_count_thousand = cell_count_thousand * 1000000
WHERE cell_count_thousand IS NOT NULL;

-- Drop batch_id and pitched_at (moved to yeast_pitch_events)
-- First drop the index, then the constraint, then the column
DROP INDEX IF EXISTS idx_yeast_pitches_batch;
ALTER TABLE yeast_pitches DROP COLUMN IF EXISTS batch_id;
ALTER TABLE yeast_pitches DROP COLUMN IF EXISTS pitched_at;

-- Add index for vessel_id
CREATE INDEX IF NOT EXISTS idx_yeast_pitches_vessel ON yeast_pitches(vessel_id);

-- =============================================================================
-- 3. Create yeast_pitch_events table
-- =============================================================================
CREATE TABLE yeast_pitch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_id UUID NOT NULL REFERENCES yeast_pitches(id),
  batch_id UUID NOT NULL REFERENCES batches(id),
  quantity_lbs DECIMAL(10,2) NOT NULL,
  cells_pitched_thousand DECIMAL(14,2),
  viability_at_pitch DECIMAL(5,2),
  pitched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_yeast_pitch_events_pitch ON yeast_pitch_events(pitch_id);
CREATE INDEX idx_yeast_pitch_events_batch ON yeast_pitch_events(batch_id);

-- RLS
ALTER TABLE yeast_pitch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY yeast_pitch_events_access ON yeast_pitch_events
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- =============================================================================
-- 4. Replace yeast_pitches_with_details view
-- =============================================================================
DROP VIEW IF EXISTS yeast_pitches_with_details CASCADE;

CREATE VIEW yeast_pitches_with_remaining
WITH (security_invoker = true)
AS
SELECT
  yp.*,
  y.name AS strain_name,
  y.manufacturer AS strain_manufacturer,
  y.product_code AS strain_code,
  y.type AS strain_type,
  y.form AS strain_form,
  y.attenuation_typical AS strain_attenuation,
  v.name AS vessel_name,
  v.vessel_type AS vessel_type,
  l.name AS location_name,
  -- Quantity remaining (total minus sum of events)
  yp.quantity_lbs - COALESCE(
    (SELECT SUM(e.quantity_lbs) FROM yeast_pitch_events e WHERE e.pitch_id = yp.id),
    0
  ) AS quantity_remaining_lbs,
  -- Batches pitched from this source
  COALESCE(
    (SELECT COUNT(DISTINCT e.batch_id) FROM yeast_pitch_events e WHERE e.pitch_id = yp.id),
    0
  )::int AS batches_pitched,
  -- Age calculation
  EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date, yp.received_date))::int AS days_old,
  -- Viability decay
  GREATEST(0, LEAST(100,
    yp.initial_viability - (
      EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date, yp.received_date))
      * CASE WHEN y.form = 'dry' THEN 0.5 ELSE 2.0 END
    )
  )) AS estimated_viability,
  -- Viability status
  CASE
    WHEN GREATEST(0, yp.initial_viability - (
      EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date, yp.received_date))
      * CASE WHEN y.form = 'dry' THEN 0.5 ELSE 2.0 END
    )) >= 90 THEN 'excellent'
    WHEN GREATEST(0, yp.initial_viability - (
      EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date, yp.received_date))
      * CASE WHEN y.form = 'dry' THEN 0.5 ELSE 2.0 END
    )) >= 75 THEN 'good'
    WHEN GREATEST(0, yp.initial_viability - (
      EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date, yp.received_date))
      * CASE WHEN y.form = 'dry' THEN 0.5 ELSE 2.0 END
    )) >= 50 THEN 'marginal'
    WHEN GREATEST(0, yp.initial_viability - (
      EXTRACT(DAY FROM NOW() - COALESCE(yp.harvest_date, yp.received_date))
      * CASE WHEN y.form = 'dry' THEN 0.5 ELSE 2.0 END
    )) >= 25 THEN 'low'
    ELSE 'inactive'
  END AS viability_status
FROM yeast_pitches yp
JOIN yeasts y ON yp.strain_id = y.id
LEFT JOIN vessels v ON yp.vessel_id = v.id
LEFT JOIN locations l ON yp.location_id = l.id;

-- =============================================================================
-- 5. Create batch_yeast_summary view
-- =============================================================================
CREATE VIEW batch_yeast_summary
WITH (security_invoker = true)
AS
SELECT
  e.batch_id,
  e.id AS event_id,
  e.pitch_id,
  e.quantity_lbs,
  e.cells_pitched_thousand,
  e.viability_at_pitch,
  e.pitched_at,
  e.notes,
  yp.strain_id,
  yp.generation,
  yp.source_type,
  y.name AS strain_name,
  y.manufacturer AS strain_manufacturer,
  y.product_code AS strain_code,
  y.type AS strain_type,
  y.form AS strain_form
FROM yeast_pitch_events e
JOIN yeast_pitches yp ON e.pitch_id = yp.id
JOIN yeasts y ON yp.strain_id = y.id;

-- =============================================================================
-- 6. Update yeast_lineage_summary view (cell_count_billion → cell_count_thousand)
-- =============================================================================
DROP VIEW IF EXISTS yeast_lineage_summary;

CREATE VIEW yeast_lineage_summary
WITH (security_invoker = true)
AS
WITH RECURSIVE lineage AS (
  SELECT
    id, id AS root_id, strain_id, parent_pitch_id,
    generation, source_type, cost, status
  FROM yeast_pitches
  WHERE source_type = 'purchase'

  UNION ALL

  SELECT
    yp.id, l.root_id, yp.strain_id, yp.parent_pitch_id,
    yp.generation, yp.source_type, yp.cost, yp.status
  FROM yeast_pitches yp
  JOIN lineage l ON yp.parent_pitch_id = l.id
)
SELECT
  l.root_id,
  y.name AS strain_name,
  root.cost AS original_cost,
  COUNT(l.id)::int AS total_pitches_in_lineage,
  COUNT(DISTINCT e.batch_id)::int AS batches_used,
  CASE
    WHEN COUNT(DISTINCT e.batch_id) > 0
    THEN ROUND(root.cost / COUNT(DISTINCT e.batch_id), 2)
    ELSE root.cost
  END AS cost_per_batch,
  MAX(l.generation)::int AS max_generations
FROM lineage l
JOIN yeasts y ON l.strain_id = y.id
JOIN yeast_pitches root ON l.root_id = root.id
LEFT JOIN yeast_pitch_events e ON e.pitch_id = l.id
GROUP BY l.root_id, y.name, root.cost;

-- =============================================================================
-- 7. Drop start_batch_fermentation function (replaced by separate operations)
-- =============================================================================
DROP FUNCTION IF EXISTS start_batch_fermentation(UUID, UUID, NUMERIC, TEXT);

-- =============================================================================
-- 8. Schema registry entries
-- =============================================================================

-- Update yeast_pitches registry entry
UPDATE _schema_registry
SET
  description = 'Tracks individual yeast pitches from purchase through brink storage and re-pitching. Supports lineage tracking, viability decay, and weight-based partial deductions via yeast_pitch_events.',
  relationships = jsonb_build_object(
    'belongs_to', jsonb_build_array('yeasts', 'vessels', 'locations'),
    'has_many', jsonb_build_array('yeast_pitch_events'),
    'self_reference', 'parent_pitch_id for lineage'
  )
WHERE table_name = 'yeast_pitches';

-- Add yeast_pitch_events registry entry
INSERT INTO _schema_registry (table_name, description, domain, relationships, key_fields)
VALUES (
  'yeast_pitch_events',
  'Immutable event log recording each yeast pitch deduction from a source (brink/purchase) into a batch. Quantity remaining on the source is calculated as total minus sum of events.',
  'production',
  jsonb_build_object(
    'belongs_to', jsonb_build_array('yeast_pitches', 'batches')
  ),
  jsonb_build_array('id', 'pitch_id', 'batch_id', 'quantity_lbs', 'cells_pitched_thousand', 'viability_at_pitch')
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  relationships = EXCLUDED.relationships,
  key_fields = EXCLUDED.key_fields;

-- Update view registry entries
UPDATE _schema_registry
SET table_name = 'yeast_pitches_with_remaining',
    description = 'Enriched yeast pitch view with strain info, vessel details, calculated quantity remaining (from events), viability decay, and age.'
WHERE table_name = 'yeast_pitches_with_details';

INSERT INTO _schema_registry (table_name, description, domain, key_fields)
VALUES (
  'batch_yeast_summary',
  'View showing all yeast pitched into a batch with strain details, generation, quantity, and cell counts.',
  'production',
  jsonb_build_array('batch_id', 'event_id', 'strain_name', 'quantity_lbs', 'cells_pitched_thousand')
)
ON CONFLICT (table_name) DO UPDATE SET
  description = EXCLUDED.description,
  domain = EXCLUDED.domain,
  key_fields = EXCLUDED.key_fields;

-- Remove start_batch_fermentation from schema registry ai_context
UPDATE _schema_registry
SET ai_context = ai_context #- '{functions}'
WHERE table_name = 'batches'
  AND ai_context ? 'functions';
```

**Step 2: Apply the migration**

Apply via the Supabase MCP tool `apply_migration` with name `yeast_workflow_unification`.

**Step 3: Verify migration applied**

Run SQL to verify:
```sql
-- Check brink type exists
SELECT 'brink'::vessel_type;

-- Check new table
SELECT column_name FROM information_schema.columns
WHERE table_name = 'yeast_pitch_events' ORDER BY ordinal_position;

-- Check modified columns on yeast_pitches
SELECT column_name FROM information_schema.columns
WHERE table_name = 'yeast_pitches' AND column_name IN ('quantity_lbs', 'cell_density_thousand', 'vessel_id', 'cell_count_thousand')
ORDER BY column_name;

-- Check batch_id was dropped
SELECT column_name FROM information_schema.columns
WHERE table_name = 'yeast_pitches' AND column_name = 'batch_id';

-- Check views exist
SELECT viewname FROM pg_views WHERE viewname IN ('yeast_pitches_with_remaining', 'batch_yeast_summary');
```

**Step 4: Generate TypeScript types**

Use the Supabase MCP tool `generate_typescript_types` to get updated types reflecting the new schema.

**Step 5: Commit**

```bash
git add supabase/migrations/00095_yeast_workflow_unification.sql
git commit -m "feat: yeast workflow unification migration

Add brink vessel type, yeast_pitch_events table for partial deductions,
modify yeast_pitches for weight-based tracking with thousand-cell precision.
Replace yeast_pitches_with_details with yeast_pitches_with_remaining view.
Add batch_yeast_summary view. Drop start_batch_fermentation function."
```

---

### Task 2: Update yeast-calculations.ts — Thousand-Cell Units

**Files:**
- Modify: `src/lib/yeast-calculations.ts`
- Modify: `src/lib/__tests__/yeast-calculations.test.ts`

**Step 1: Update types and interfaces**

In `src/lib/yeast-calculations.ts`, change all interfaces from billion to thousand:

```typescript
// Change CellCountEstimate
export interface CellCountEstimate {
  cellsThousand: number;  // was cellsBillion
  confidence: "high" | "medium" | "low";
  notes: string;
}

// Change PitchingRateResult
export interface PitchingRateResult {
  cellsNeeded: number;  // now in thousands
  packagesNeeded: number;
  starterRecommended: boolean;
  starterVolumeMl: number | null;
  lbsNeeded?: number;  // NEW: weight-based output
}
```

**Step 2: Update function implementations**

Update all functions to work in thousands:
- `estimateCellsFromPackage()` — return thousands instead of billions (liquid ~100B = 100,000,000 thousand)
- `estimateCellsFromSlurry()` — return thousands
- `calculatePitchingRate()` — work in thousands, add optional `cellDensityThousandPerLb` param to calculate `lbsNeeded`

Add new function:
```typescript
/**
 * Calculate how many lbs to pitch from a brink given batch requirements.
 * @param cellsNeededThousand - Total cells needed (thousands)
 * @param cellDensityThousandPerLb - Cell density of brink (thousands per lb)
 * @param viability - Current viability percentage (0-100)
 * @returns Weight in lbs to pitch
 */
export function calculatePitchWeightLbs(
  cellsNeededThousand: number,
  cellDensityThousandPerLb: number,
  viability: number
): number {
  if (cellDensityThousandPerLb <= 0 || viability <= 0) return 0;
  const viableCellsPerLb = cellDensityThousandPerLb * (viability / 100);
  return Math.ceil((cellsNeededThousand / viableCellsPerLb) * 10) / 10; // Round up to 0.1 lb
}
```

Also add a display formatting utility:
```typescript
/**
 * Format cell count for display.
 * @param thousand - Cell count in thousands
 * @returns Human-readable string like "450M" or "750K"
 */
export function formatCellCount(thousand: number): string {
  if (thousand >= 1_000_000) {
    const billions = thousand / 1_000_000;
    return `${Number(billions.toFixed(1))}B`;
  }
  if (thousand >= 1_000) {
    const millions = thousand / 1_000;
    return `${Number(millions.toFixed(1))}M`;
  }
  return `${Number(thousand.toFixed(0))}K`;
}
```

**Step 3: Update tests**

Update `src/lib/__tests__/yeast-calculations.test.ts`:
- Change all assertions from `cellsBillion` to `cellsThousand`
- Add tests for `calculatePitchWeightLbs()`
- Add tests for `formatCellCount()`
- Update expected values (multiply old billion values by 1,000,000 for thousands)

**Step 4: Run tests**

```bash
pnpm vitest run src/lib/__tests__/yeast-calculations.test.ts
```

Expected: All tests pass.

**Step 5: Run typecheck**

```bash
pnpm typecheck
```

Note: This will likely show errors in components that reference `cellsBillion`. Those will be fixed in later tasks. Verify that the calculation file itself has no errors.

**Step 6: Commit**

```bash
git add src/lib/yeast-calculations.ts src/lib/__tests__/yeast-calculations.test.ts
git commit -m "feat: update yeast calculations to thousand-cell units

Change base unit from billions to thousands for precision at rates
like 400K cells/mL/°P. Add calculatePitchWeightLbs() for weight-based
pitching from brinks. Add formatCellCount() display formatter."
```

---

### Task 3: Update Vessel Entity Config — Add Brink

**Files:**
- Modify: `src/entities/vessel.tsx`
- Modify: `src/lib/schemas/batch.ts` (if vessel type is referenced)

**Step 1: Add brink to VESSEL_TYPES**

In `src/entities/vessel.tsx`, add to the `VESSEL_TYPES` array:

```typescript
export const VESSEL_TYPES = [
  { value: "fermenter", label: "Fermenter" },
  { value: "brite", label: "Brite Tank" },
  { value: "kettle", label: "Kettle" },
  { value: "mash_tun", label: "Mash Tun" },
  { value: "hlt", label: "HLT" },
  { value: "unitank", label: "Unitank" },
  { value: "foeder", label: "Foeder" },
  { value: "barrel", label: "Barrel" },
  { value: "brink", label: "Brink" },
] as const;
```

**Step 2: Update the Zod schema**

In `src/entities/vessel.tsx`, update the vessel_type enum:

```typescript
vessel_type: z.enum([
  "fermenter",
  "brite",
  "kettle",
  "mash_tun",
  "hlt",
  "unitank",
  "foeder",
  "barrel",
  "brink",
]),
```

**Step 3: Run typecheck**

```bash
pnpm typecheck
```

**Step 4: Commit**

```bash
git add src/entities/vessel.tsx
git commit -m "feat: add brink to vessel types

Brinks are yeast storage vessels that participate in the vessel
management system with capacity, status, and location tracking."
```

---

### Task 4: Update Yeast Pitch Entity Config

**Files:**
- Modify: `src/entities/yeast-pitch.tsx`

**Step 1: Update the viewTable reference**

Change `viewTable` from `yeast_pitches_with_details` to `yeast_pitches_with_remaining`.

**Step 2: Update form schema**

Update the Zod schema:
- Rename `cell_count_billion` → `cell_count_thousand`
- Add `quantity_lbs: z.coerce.number().min(0).nullable().optional()`
- Add `cell_density_thousand: z.coerce.number().min(0).nullable().optional()`
- Add `vessel_id: z.string().uuid().nullable().optional()`
- Remove `batch_id` and `pitched_at` fields

**Step 3: Update list columns**

Update columns that reference old field names:
- Change any `cell_count_billion` references to `cell_count_thousand`
- Add `quantity_remaining_lbs` column showing remaining weight
- Update the viability column to continue working with the renamed view

**Step 4: Update detail sections**

Revise sections per design:
- **Pitch Info** — strain, manufacturer, code, source type, generation, status
- **Vessel** — vessel_id (relation to vessels, filtered to brinks), vessel name, capacity
- **Inventory** — quantity_lbs, quantity_remaining_lbs (read-only computed), cell_density_thousand
- **Viability** — initial_viability, estimated_viability (read-only), viability_status, days_old
- **Cost** — cost, cost_per_batch (read-only)
- **Notes** — notes

Remove old fields: `batch_id`, `pitched_at`, `volume_ml` references in main sections (keep volume_ml in form for backward compat).

**Step 5: Update actions**

```typescript
actions: [
  {
    name: "pitch_to_batch",
    label: "Pitch to Batch",
    icon: "flask",
    type: "button",
    fromStates: ["in_stock"],
    // No toState - handled by custom dialog
  },
  {
    name: "record_cell_count",
    label: "Record Cell Count",
    icon: "microscope",
    type: "button",
    fromStates: ["in_stock"],
    // No toState - updates viability fields
  },
  {
    name: "discard",
    label: "Discard",
    icon: "trash",
    type: "dropdown",
    variant: "destructive",
    fromStates: ["in_stock"],
    toState: "discarded",
  },
],
```

Remove: `use`, `harvest`, `mark_depleted` actions.

**Step 6: Add yeast_pitch_events relation**

```typescript
relations: [
  // ... existing parent pitch relation
  {
    name: "pitch_events",
    entity: "yeast_pitch_event",
    type: "hasMany",
    foreignKey: "pitch_id",
    showInDetail: true,
    detailTab: "Usage History",
  },
],
```

**Step 7: Run typecheck**

```bash
pnpm typecheck
```

**Step 8: Commit**

```bash
git add src/entities/yeast-pitch.tsx
git commit -m "feat: update yeast pitch entity for brink model

Rename view to yeast_pitches_with_remaining, add weight and vessel fields,
replace actions with Pitch to Batch and Record Cell Count,
add usage history relation via yeast_pitch_events."
```

---

### Task 5: Update Query Keys

**Files:**
- Modify: `src/lib/query-keys.ts`

**Step 1: Add pitch event keys and batch yeast keys**

```typescript
export const yeastKeys = {
  all: () => ["yeast-pitches"] as const,
  detail: (id: string) => ["yeast-pitches", id] as const,
  available: () => ["yeast-pitches", "available"] as const,
  lineageRoot: (pitchId: string) => ["yeast-lineage-root", pitchId] as const,
  lineage: (rootId: string | undefined) => ["yeast-lineage", rootId] as const,
  lineageSummary: (rootId: string | undefined) => ["yeast-lineage-summary", rootId] as const,
  events: (pitchId: string) => ["yeast-pitch-events", pitchId] as const,
};

// Add to batchKeys:
export const batchKeys = {
  // ... existing keys
  yeast: (id: string) => ["batches", id, "yeast"] as const,
  yeastSummary: (id: string) => ["batch-yeast-summary", id] as const,
};
```

**Step 2: Add vessel keys if not present**

Check if `vesselKeys.available()` exists. If not, add:
```typescript
export const vesselKeys = {
  // ... existing keys
  available: () => ["vessels", "available"] as const,
  brinks: () => ["vessels", "brinks"] as const,
};
```

**Step 3: Run typecheck**

```bash
pnpm typecheck
```

**Step 4: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat: add query keys for yeast events and batch yeast summary"
```

---

### Task 6: Create PitchYeastDialog Component

**Files:**
- Create: `src/components/domain/pitch-yeast-dialog.tsx`

**Reference patterns:**
- Dialog structure: `src/components/domain/yeast-harvest-dialog.tsx`
- Vessel query: `src/components/domain/vessel-transfer-dialog.tsx`
- Pitch rate math: `src/lib/yeast-calculations.ts`

**Step 1: Create the component**

```typescript
"use client";

/**
 * Pitch Yeast Dialog
 *
 * Select a yeast source (brink/purchase), calculate pitch rate,
 * and record a partial deduction into a batch via yeast_pitch_events.
 */

import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import {
  calculatePitchingRate,
  calculatePitchWeightLbs,
  formatCellCount,
  sgToPlato,
} from "@/lib/yeast-calculations";
import { yeastKeys, batchKeys, entityKeys } from "@/lib/query-keys";

const pitchYeastSchema = z.object({
  pitch_id: z.string().uuid("Select a yeast source"),
  viability: z.coerce.number().min(0).max(100),
  quantity_lbs: z.coerce.number().positive("Quantity must be positive"),
  notes: z.string().nullable().optional(),
});

type PitchYeastFormValues = z.infer<typeof pitchYeastSchema>;

interface PitchYeastDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchName: string;
  batchVolumeBbl?: number | null;
  recipeOg?: number | null;
  recipeYeastIds?: string[];
  preselectedPitchId?: string;
  onSuccess?: () => void;
  /** Called after successful pitch with suggested next state */
  onSuggestTransition?: (toState: string) => void;
}
```

The component should:
1. Query `yeast_pitches_with_remaining` for available pitches (status = 'in_stock', quantity_remaining_lbs > 0)
2. Highlight pitches matching `recipeYeastIds` (sort them first)
3. When a pitch is selected, show its viability (pre-filled from `estimated_viability`, editable)
4. Calculate pitch rate: `calculatePitchingRate(batchVolumeBbl, ogPlato)` → cells needed
5. Calculate lbs needed: `calculatePitchWeightLbs(cellsNeeded, selectedPitch.cell_density_thousand, viability)`
6. Pre-fill `quantity_lbs` with calculated value
7. Show "Brink will have X lbs remaining after pitch"
8. On submit: insert into `yeast_pitch_events`, invalidate queries
9. If pitch depletes source (remaining ≈ 0), update pitch status to 'depleted'
10. Call `onSuggestTransition("fermenting")` if batch is currently "planned"

**Step 2: Run typecheck**

```bash
pnpm typecheck
```

**Step 3: Run lint**

```bash
pnpm lint
```

**Step 4: Commit**

```bash
git add src/components/domain/pitch-yeast-dialog.tsx
git commit -m "feat: create PitchYeastDialog component

Select yeast source, calculate pitch rate, deduct from brink,
record yeast_pitch_event. Supports pitch rate calculation
and suggests state transition after pitching."
```

---

### Task 7: Update YeastHarvestDialog — Batch Context

**Files:**
- Modify: `src/components/domain/yeast-harvest-dialog.tsx`

**Step 1: Update props interface**

Change from source-pitch-centric to batch-centric:

```typescript
interface YeastHarvestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchName: string;
  /** Pitch events for this batch — determines which strains can be harvested */
  pitchedStrains: Array<{
    pitch_id: string;
    strain_id: string;
    strain_name: string;
    generation: number;
  }>;
  onSuccess?: () => void;
}
```

**Step 2: Update form schema**

```typescript
const harvestSchema = z.object({
  source_pitch_id: z.string().uuid("Select source strain"),
  vessel_id: z.string().uuid("Select a brink"),
  quantity_lbs: z.coerce.number().positive("Weight is required"),
  cell_count_thousand: z.coerce.number().min(0).nullable().optional(),
  initial_viability: z.coerce.number().min(0).max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
});
```

**Step 3: Update form UI**

- Add source strain selector (from `pitchedStrains` prop)
- Replace location selector with brink vessel selector (query vessels where `vessel_type = 'brink'`)
- Change volume_ml field to quantity_lbs
- Change cell_count_billion to cell_count_thousand
- Update slurry density estimation to output thousands
- Show "New Generation: G{n+1}" based on selected source pitch

**Step 4: Update submission logic**

On submit:
1. Create new `yeast_pitch` with `vessel_id` (brink), `quantity_lbs`, `cell_count_thousand`, `source_type = 'harvest'`, `parent_pitch_id = source_pitch_id`
2. Generation auto-increments via existing trigger
3. Invalidate yeast and batch queries

Remove: source pitch status update to 'harvested' (the source pitch stays in_stock — it still has remaining quantity via events model)

**Step 5: Run typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

**Step 6: Commit**

```bash
git add src/components/domain/yeast-harvest-dialog.tsx
git commit -m "feat: update harvest dialog for batch-centric brink model

Move from yeast-pitch-detail to batch-detail context. Target brink
vessels instead of locations. Use weight (lbs) and thousand-cell counts.
Select source strain from pitched yeasts in the batch."
```

---

### Task 8: Update TransferDialog — Smart State Suggestions

**Files:**
- Modify: `src/components/domain/vessel-transfer-dialog.tsx`

**Step 1: Add onSuggestTransition prop**

```typescript
interface VesselTransferDialogProps {
  batchId: string;
  batchNumber: string;
  batchStatus: string;  // NEW: current batch status
  fromVesselId: string | null;
  fromVesselName: string | null;
  currentVolume?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  onSuggestTransition?: (toState: string, vesselName: string) => void;  // NEW
}
```

**Step 2: Remove hardcoded status update**

Currently the mutation directly updates batch status to "conditioning". Remove this — the status change will be suggested, not forced.

Replace:
```typescript
// Update batch status to conditioning
const { error: statusError } = await supabase
  .from("batches")
  .update({ status: "conditioning" })
  .eq("id", batchId);
```

With: just the vessel_transfer insert. After success, determine the suggested state:

```typescript
onSuccess: (vesselName) => {
  // Determine suggested state based on destination vessel type
  const destVessel = availableVessels?.find((v) => v.id === values.to_vessel_id);
  const vesselType = destVessel?.vessel_type;

  let suggestedState: string | undefined;
  if (batchStatus === "planned" && (vesselType === "fermenter" || vesselType === "unitank")) {
    suggestedState = "fermenting";
  } else if (batchStatus === "fermenting" && vesselType === "brite") {
    suggestedState = "conditioning";
  }

  if (suggestedState && onSuggestTransition) {
    onSuggestTransition(suggestedState, vesselName);
  }

  onSuccess?.();
}
```

**Step 3: Allow transfer from planned state**

Currently the transfer dialog may only be invoked from fermenting state. The dialog itself should work from any active state — the batch entity config (Task 9) controls when the action is available.

**Step 4: Run typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

**Step 5: Commit**

```bash
git add src/components/domain/vessel-transfer-dialog.tsx
git commit -m "feat: smart state suggestions in transfer dialog

Remove hardcoded status update. Instead, suggest state transition
based on destination vessel type (fermenter→fermenting, brite→conditioning).
Accept batchStatus prop for context-aware suggestions."
```

---

### Task 9: Update Batch Entity Config + Detail Page

**Files:**
- Modify: `src/entities/batch.tsx`
- Modify: `src/lib/schemas/batch.ts`
- Modify: `src/app/(app)/production/batches/[id]/page.tsx`

**Step 1: Update batch actions in entity config**

In `src/entities/batch.tsx`, replace the actions array:

```typescript
actions: [
  {
    name: "transfer",
    label: "Transfer",
    icon: "arrow-right",
    type: "button",
    fromStates: ["planned", "fermenting", "conditioning"],
    // No toState — suggested by dialog based on vessel type
  },
  {
    name: "pitch_yeast",
    label: "Pitch Yeast",
    icon: "flask",
    type: "button",
    fromStates: ["planned", "fermenting"],
    // No toState — suggested after pitch
  },
  {
    name: "harvest_yeast",
    label: "Harvest Yeast",
    icon: "download",
    type: "button",
    fromStates: ["fermenting", "conditioning"],
    // No toState
  },
  {
    name: "start_packaging",
    label: "Start Packaging",
    icon: "package",
    type: "button",
    fromStates: ["conditioning"],
    toState: "packaging",
  },
  {
    name: "complete",
    label: "Complete",
    icon: "check",
    type: "button",
    fromStates: ["packaging"],
    toState: "completed",
  },
  {
    name: "blend",
    label: "Blend Batches",
    icon: "git-merge",
    type: "dropdown",
    fromStates: ["fermenting", "conditioning"],
  },
  {
    name: "cancel",
    label: "Cancel Batch",
    icon: "x",
    type: "dropdown",
    variant: "destructive",
    fromStates: ["planned"],
    toState: "cancelled",
  },
  {
    name: "archive",
    label: "Archive Batch",
    icon: "archive",
    type: "dropdown",
    variant: "destructive",
    fromStates: ["fermenting", "conditioning", "packaging"],
    toState: "archived",
  },
],
```

**Step 2: Update batch transitions in schema**

In `src/lib/schemas/batch.ts`, update transitions to allow action-triggered transitions from planned and fermenting:

```typescript
export const batchTransitions: Record<string, string[]> = {
  planned: ["fermenting"],       // via Transfer/Pitch suggestion
  fermenting: ["conditioning"],  // via Transfer suggestion
  conditioning: ["packaging"],
  packaging: ["completed"],
  completed: [],
  cancelled: [],
  archived: [],
};
```

**Step 3: Add yeast section to batch detail**

In `src/entities/batch.tsx`, add a new section in the sections array. Create a `BatchYeastSection` domain component that:
- Queries `batch_yeast_summary` view for this batch
- Shows pitched yeast table (strain, gen, lbs, cells, viability, date)
- Shows harvested yeast (yeast_pitches where parent came from this batch's events)
- Shows recipe yeast context (what the recipe calls for)

**Step 4: Add yeast relation to batch entity config**

```typescript
relations: [
  // ... existing relations
  {
    name: "yeast_events",
    entity: "yeast_pitch_event",
    type: "hasMany",
    foreignKey: "batch_id",
    showInDetail: false, // shown via custom BatchYeastSection
  },
],
```

**Step 5: Update batch detail page action handler**

In `src/app/(app)/production/batches/[id]/page.tsx`:

Import new dialogs:
```typescript
import { PitchYeastDialog } from "@/components/domain/pitch-yeast-dialog";
import { YeastHarvestDialog } from "@/components/domain/yeast-harvest-dialog";
```

Add state for new dialogs:
```typescript
const [showPitchYeast, setShowPitchYeast] = useState(false);
const [showHarvestYeast, setShowHarvestYeast] = useState(false);
```

Update the `handleAction` callback:
```typescript
const handleAction = useCallback((actionName: string) => {
  if (actionName === "transfer") {
    setShowTransfer(true);
    return true;
  }
  if (actionName === "pitch_yeast") {
    setShowPitchYeast(true);
    return true;
  }
  if (actionName === "harvest_yeast") {
    setShowHarvestYeast(true);
    return true;
  }
  if (actionName === "cancel" || actionName === "archive") {
    setShowCancellation(true);
    return true;
  }
  if (actionName === "blend") {
    setShowBlend(true);
    return true;
  }
  return false;
}, []);
```

Remove: `showStartFermentation` state and `StartFermentationDialog` import/render.

**Step 6: Implement state transition suggestion handler**

Add a handler that shows a confirmation toast after Transfer or Pitch:

```typescript
const handleSuggestTransition = useCallback(async (toState: string, context?: string) => {
  const stateLabels: Record<string, string> = {
    fermenting: "fermenting",
    conditioning: "conditioning",
  };

  toast(`Mark batch as ${stateLabels[toState] || toState}?`, {
    description: context || undefined,
    action: {
      label: "Yes, update",
      onClick: async () => {
        const supabase = createClient();
        const { error } = await supabase
          .from("batches")
          .update({ status: toState })
          .eq("id", batch.id);
        if (error) {
          toast.error("Failed to update status");
        } else {
          queryClient.invalidateQueries({ queryKey: batchKeys.detail(batch.id) });
          toast.success(`Batch marked as ${stateLabels[toState]}`);
        }
      },
    },
    cancel: { label: "Not yet", onClick: () => {} },
  });
}, [batch?.id, queryClient]);
```

Pass this to `PitchYeastDialog` and `VesselTransferDialog` via `onSuggestTransition`.

**Step 7: Render new dialogs**

Add dialog renders alongside existing ones:
```typescript
<PitchYeastDialog
  open={showPitchYeast}
  onOpenChange={setShowPitchYeast}
  batchId={batch.id}
  batchName={batch.name}
  batchVolumeBbl={batch.volume_bbl}
  recipeOg={batch.target_og}
  onSuccess={handleDialogSuccess}
  onSuggestTransition={(state) => handleSuggestTransition(state, "Yeast pitched successfully")}
/>

<YeastHarvestDialog
  open={showHarvestYeast}
  onOpenChange={setShowHarvestYeast}
  batchId={batch.id}
  batchName={batch.name}
  pitchedStrains={batchYeastData}
  onSuccess={handleDialogSuccess}
/>
```

**Step 8: Run typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

**Step 9: Commit**

```bash
git add src/entities/batch.tsx src/lib/schemas/batch.ts \
  src/app/(app)/production/batches/[id]/page.tsx \
  src/components/domain/batch-yeast-section.tsx
git commit -m "feat: action-driven batch workflow with yeast integration

Replace Start Fermentation and Move to Conditioning with granular
Transfer, Pitch Yeast, and Harvest Yeast actions. Add yeast section
to batch detail. State transitions suggested after actions."
```

---

### Task 10: Update Yeast Pitch Detail Page

**Files:**
- Modify: `src/app/(app)/production/yeast-pitches/[id]/page.tsx`
- Create: `src/components/domain/record-cell-count-dialog.tsx`

**Step 1: Create RecordCellCountDialog**

Simple dialog for updating viability based on a lab measurement:

```typescript
interface RecordCellCountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pitchId: string;
  pitchName: string;
  onSuccess?: () => void;
}
```

Form fields:
- Cell count (thousand cells) — measured value
- Viability (%) — from hemocytometer
- Date measured (defaults to today)

On submit: update `yeast_pitches` set `cell_count_thousand`, `initial_viability` (this resets the decay baseline).

**Step 2: Update action handler**

In `src/app/(app)/production/yeast-pitches/[id]/page.tsx`:

```typescript
const handleAction = (actionName: string, data: any): boolean => {
  if (actionName === "pitch_to_batch") {
    setPitchData(data);
    setShowPitchDialog(true);
    return true;
  }
  if (actionName === "record_cell_count") {
    setPitchData(data);
    setShowCellCountDialog(true);
    return true;
  }
  return false;
};
```

Remove: harvest dialog state and trigger (harvest is now on batch detail).

**Step 3: Render new dialogs**

```typescript
<PitchYeastDialog
  open={showPitchDialog}
  onOpenChange={setShowPitchDialog}
  preselectedPitchId={pitchData?.id}
  // batch selection happens inside the dialog
/>

<RecordCellCountDialog
  open={showCellCountDialog}
  onOpenChange={setShowCellCountDialog}
  pitchId={pitchData?.id}
  pitchName={pitchData?.strain_name}
  onSuccess={() => queryClient.invalidateQueries({ queryKey: yeastKeys.detail(id) })}
/>
```

**Step 4: Run typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

**Step 5: Commit**

```bash
git add src/app/(app)/production/yeast-pitches/[id]/page.tsx \
  src/components/domain/record-cell-count-dialog.tsx
git commit -m "feat: update yeast pitch detail with pitch-to-batch and cell count

Replace Use for Batch and Harvest actions with Pitch to Batch and
Record Cell Count. Add RecordCellCountDialog for lab measurements."
```

---

### Task 11: Update Lineage Display + Chat Tools + Cleanup

**Files:**
- Modify: `src/components/domain/yeast-lineage-display.tsx` — update `cellsBillion` → `cellsThousand` references, use `formatCellCount()`
- Modify: `src/app/api/chat/tools.ts` — update `listYeastPitches` tool to query `yeast_pitches_with_remaining` and return new fields
- Modify: `src/components/domain/yeast-selector.tsx` — verify no breaking changes from billion→thousand rename
- Modify: `docs/data-model/production.md` — update yeast pitch documentation to reflect new schema
- Update: `CLAUDE.md` — bump migration number to `Current highest: 00095`, `Next available: 00096`

**Step 1: Fix all remaining typecheck errors**

Run `pnpm typecheck` and fix any remaining references to:
- `cellsBillion` → `cellsThousand`
- `cell_count_billion` → `cell_count_thousand`
- `yeast_pitches_with_details` → `yeast_pitches_with_remaining`
- `batch_id` on yeast_pitches (removed)
- `start_fermentation` action name
- `StartFermentationDialog` imports

**Step 2: Update data model docs**

Update `docs/data-model/production.md` with:
- New `yeast_pitch_events` table documentation
- Updated `yeast_pitches` column list (new fields, removed fields)
- New `yeast_pitches_with_remaining` view description
- New `batch_yeast_summary` view description

**Step 3: Run full validation**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run
```

All must pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: cleanup references for yeast workflow unification

Update lineage display, chat tools, data model docs, and fix
all remaining references to old field names and view names."
```

---

### Task 12: Integration Verification

**Step 1: Verify the full workflow end-to-end**

Run the dev server and manually verify:
1. Create a brink vessel (vessel type = brink)
2. Create a yeast pitch (purchase) with quantity_lbs and cell_density
3. Create a batch from a recipe with yeast
4. Transfer batch to fermenter → verify "Mark as fermenting?" suggestion
5. Pitch yeast from the brink → verify pitch rate calculation, quantity deduction
6. Check brink detail → verify quantity remaining decreased
7. Check batch detail → verify yeast section shows pitched info
8. Harvest yeast from batch → verify new pitch created in brink with generation + 1
9. Check lineage display → verify tree still works

**Step 2: Run full test suite**

```bash
pnpm vitest run && pnpm typecheck && pnpm lint
```

**Step 3: Run security advisors**

Use Supabase MCP `get_advisors` for security + performance on the project.

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration verification fixes"
```

---

## Summary

| Task | Description | Dependencies | Est. Complexity |
|------|-------------|-------------|-----------------|
| 1 | Database migration | None | Medium |
| 2 | yeast-calculations.ts (thousands) | None | Medium |
| 3 | Vessel config (add brink) | Task 1 | Low |
| 4 | Yeast pitch entity config | Task 1 | Medium |
| 5 | Query keys | None | Low |
| 6 | PitchYeastDialog (new) | Tasks 1, 2, 5 | High |
| 7 | YeastHarvestDialog (update) | Tasks 1, 5 | Medium |
| 8 | TransferDialog (update) | Task 1 | Medium |
| 9 | Batch entity + detail page | Tasks 1, 5, 6, 7, 8 | High |
| 10 | Yeast pitch detail page | Tasks 4, 5, 6 | Medium |
| 11 | Cleanup + docs | All above | Medium |
| 12 | Integration verification | All above | Low |
