# Brew Day UX Enhancement Design

## Problem

The brew log and batch user journey has four pain points:
1. **Disconnected navigation** — hard to jump between a brew log and its linked batches
2. **Too many steps** — recording a brew, linking to batches, assigning vessels requires too much context-switching
3. **No "what's next" guidance** — after completing a step, it's unclear where to go
4. **Batch creation feels disconnected** — creating a batch and associating it with a brew log are separate flows

## Approach

Unified Brew Day Wizard approach: replace the multi-page, multi-click journey with guided flows that take a brewer from "I'm about to brew" to "wort is in the fermenter" with minimal friction. Optimizes for the common 1:1 (one brew, one batch) case while preserving support for splits.

## Design

### 1. "What's Next" Contextual Banners

New `NextStepBanner` component at the top of entity detail pages, contextual to current state:

| Entity | State | Banner | Action |
|--------|-------|--------|--------|
| Brew Log | `draft`, no events | "Ready to start brewing? Begin recording your brew day." | "Start Brew" button |
| Brew Log | `in_progress`, has events | "Done brewing? Complete your brew log to move wort to fermenters." | "Complete Brew" button |
| Brew Log | `completed` | "Brew complete. View your batch in the fermenter." | Link to batch detail |
| Batch | `planned`, no brew log linked | "This batch needs a brew. Start a brew day or link an existing brew log." | "Start Brew Day" / "Link Brew" buttons |
| Batch | `planned`, brew log linked | "Brew is linked. Start fermentation when ready." | "Start Fermentation" button |
| Batch | `fermenting` | "Track fermentation progress with readings and additions." | Links to readings/additions |

Non-blocking colored strip — disappears once the suggested action is taken.

### 2. Integrated Timeline on Brew Log Detail

Move the full interactive `BrewEventTimeline` onto the brew log detail page. Remove the separate `/events` route.

**Section ordering:**
1. NextStepBanner
2. Overview (brew number, date, recipe, brewer)
3. **Timeline** (full interactive event recording — primary content)
4. Batch Splits (existing `BrewLogSplitOverview`)
5. Notes

Read-only when status is `completed` or `cancelled` (same as today).

The brew log detail page *is* the brew day page.

### 3. Inline Brew Summary on Batch Detail

Expand `BatchBrewInfo` to show a richer inline summary per linked brew log:

- Brew number (clickable link)
- Brew date
- Brewer
- Actual OG
- Volume contributed to this batch
- Key phase highlights — 2-3 notable measurements from brew events (mash temp, pre-boil gravity, post-boil volume) as metric chips
- Split notes (from junction table)

For the common 1:1 case: single card. For blends: stacked cards.

`BrewLogLinker` moves below the summary and becomes secondary/collapsible.

Data: extend the linked brew logs query to include `brew_logs.events` JSON for phase highlights.

### 4. Unified "Start Brew Day" Entry Points

The `StartBrewDayDialog` 3-step wizard exists but is only accessible from recipe detail.

**New entry points:**

1. **Brew logs list page** — primary action button in list header. Opens wizard with a recipe selector prepended (step 0) before the existing 3 steps.

2. **Batch detail page** — when batch is `planned` with no linked brew log. Pre-fills wizard with the batch's recipe and auto-links the resulting brew log to this batch (skips "configure splits" step since the batch already exists).

3. **Brewer field defaults to current user** in wizard step 1.

After completion: navigate to brew log detail page (already happens). NextStepBanner guides the next action.

### 5. Brew Completion Wizard

Replace the single-step `BrewLogCompletionDialog` with a 3-step wizard:

**Step 1: Review Measurements**
- Pull key measurements from brew events (post-boil OG, volume, final temp)
- Display as summary card for confirmation
- Editable — brewer can add/correct before completing

**Step 2: Assign Vessels**
- Same vessel assignment as today
- Auto-suggest best-fit vessel based on batch volume vs. vessel capacity
- Show capacity utilization (e.g., "7 BBL into 10 BBL — 70%")

**Step 3: Confirm & Complete**
- Summary of what will happen
- "Complete Brew Day" button
- On success: navigate to batch detail page (forward in the journey, not stay on brew log)

### 6. Cross-Navigation & Journey Continuity

**Contextual breadcrumb** on brew log and batch detail pages:
- `Recipe Name → Brew Log BRW-2024-042 → Batch B-20240315-01`
- Each segment clickable, current page non-clickable
- For batches with multiple linked brews, show primary (highest volume) brew

**Post-action navigation** — navigate forward in the journey:
- Start Brew Day wizard → brew log detail
- Complete Brew wizard → batch detail
- Start Fermentation dialog → stay on batch detail (NextStepBanner guides)

**Batch quick link** — add 4th item to `BatchQuickLinks`: "Brew Log" linking to the associated brew log. Only shown when a brew log is linked.

## Summary of Changes

### New Components
- `NextStepBanner` — contextual guidance banners for brew logs and batches

### Modified Components
- `BrewLogTimeline` → render full `BrewEventTimeline` inline (no compact mode)
- `BatchBrewInfo` → richer inline summary with phase highlights, brewer field
- `BrewLogCompletionDialog` → 3-step wizard (review → assign → confirm)
- `StartBrewDayDialog` → add recipe selector step, brewer defaults to current user
- `BatchQuickLinks` → add 4th "Brew Log" link
- Brew log entity config → reorder sections, remove events page link
- Batch entity config → add breadcrumb, NextStepBanner

### Removed
- `/production/brew-logs/[id]/events/` page route (integrated into detail)

### New Entry Points
- Brew logs list page → "Start Brew Day" button
- Batch detail page (planned, no brew linked) → "Start Brew Day" action
