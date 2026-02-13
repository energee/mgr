# Brew Day UX Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the brew log ↔ batch user journey with contextual guidance, integrated timeline, richer cross-entity summaries, and streamlined entry points.

**Architecture:** Six independent workstreams that modify existing components in `src/components/domain/` and `src/entities/`, plus one new shared component (`NextStepBanner`). Each task is self-contained with minimal cross-dependencies. The EntityDetailUnified wrapper pages in `src/app/(app)/production/` are the integration points.

**Tech Stack:** React, TypeScript, TanStack Query, Supabase client, shadcn/ui, Lucide icons, Sonner toasts.

**Design doc:** `docs/plans/2026-02-12-brew-day-ux-design.md`

---

## Task 1: NextStepBanner Component

Create a reusable contextual banner that shows "what's next" guidance at the top of entity detail pages.

**Files:**
- Create: `src/components/domain/next-step-banner.tsx`

**Step 1: Create the NextStepBanner component**

This is a simple presentational component. It receives a configuration and renders a colored strip with message + action button(s).

```tsx
// src/components/domain/next-step-banner.tsx
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Play, CheckCircle, Link2, Thermometer, FlaskConical } from "lucide-react";

interface BannerAction {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}

interface NextStepBannerProps {
  message: string;
  actions: BannerAction[];
  variant?: "info" | "success" | "default";
}

export function NextStepBanner({ message, actions, variant = "info" }: NextStepBannerProps) {
  const variantStyles = {
    info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
    success: "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100",
    default: "border-border bg-muted/50 text-foreground",
  };

  return (
    <div className={`flex items-center justify-between gap-4 rounded-lg border p-4 ${variantStyles[variant]}`}>
      <p className="text-sm font-medium">{message}</p>
      <div className="flex items-center gap-2 shrink-0">
        {actions.map((action) =>
          action.href ? (
            <Button key={action.label} variant="outline" size="sm" asChild className="min-h-[36px]">
              <Link href={action.href}>
                {action.icon}
                {action.label}
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          ) : (
            <Button key={action.label} variant="outline" size="sm" onClick={action.onClick} className="min-h-[36px]">
              {action.icon}
              {action.label}
            </Button>
          )
        )}
      </div>
    </div>
  );
}
```

**Step 2: Run lint**

Run: `pnpm lint`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/components/domain/next-step-banner.tsx
git commit -m "feat: add NextStepBanner component for contextual guidance"
```

---

## Task 2: Integrate NextStepBanner into Brew Log Detail

Wire up the `NextStepBanner` on the brew log detail page with state-dependent messaging. Also integrate the banner into the page by rendering it above `EntityDetailUnifiedWithErrorBoundary`.

**Files:**
- Modify: `src/app/(app)/production/brew-logs/[id]/page.tsx`

**Step 1: Add banner logic to the brew log detail page**

The page already fetches brew log data (id, brew_number, status). Extend the query to also fetch `events` (needed to check if events exist) and linked batches (needed for the "View batch" link after completion).

Add a helper function that returns the banner config based on current state:

```tsx
// Add to imports:
import { NextStepBanner } from "@/components/domain/next-step-banner";

// Extend the existing query to include events count and linked batch info:
// Change the select from "id, brew_number, status" to:
// "id, brew_number, status, events"
// Also add a query for linked batches (for the completion banner):
const { data: linkedBatches } = useQuery({
  queryKey: brewLogKeys.batches(id),
  queryFn: async () => {
    const { data, error } = await supabase
      .from("brew_log_batches")
      .select("batch_id")
      .eq("brew_log_id", id);
    if (error) throw error;
    return data ?? [];
  },
});

// Banner logic function:
function getBannerConfig(brewLog, linkedBatches, onAction) {
  if (!brewLog) return null;
  const events = (brewLog.events as unknown[]) || [];

  if (brewLog.status === "draft") {
    return {
      message: "Ready to start brewing? Begin recording your brew day.",
      variant: "info" as const,
      actions: [{ label: "Start Brew", onClick: () => onAction("start_brew") }],
    };
  }
  if (brewLog.status === "in_progress" && events.length > 0) {
    return {
      message: "Done brewing? Complete your brew log to move wort to fermenters.",
      variant: "info" as const,
      actions: [{ label: "Complete Brew", onClick: () => onAction("complete_brew") }],
    };
  }
  if (brewLog.status === "completed" && linkedBatches?.length === 1) {
    return {
      message: "Brew complete. View your batch in the fermenter.",
      variant: "success" as const,
      actions: [{ label: "View Batch", href: `/production/batches/${linkedBatches[0].batch_id}` }],
    };
  }
  if (brewLog.status === "completed" && linkedBatches && linkedBatches.length > 1) {
    return {
      message: `Brew complete. ${linkedBatches.length} batches are in fermentation.`,
      variant: "success" as const,
      actions: linkedBatches.map((b, i) => ({
        label: `Batch ${i + 1}`,
        href: `/production/batches/${b.batch_id}`,
      })),
    };
  }
  return null;
}
```

**Step 2: Render the banner above EntityDetailUnified**

In the return JSX, wrap existing content in a fragment and add the banner at the top:

```tsx
return (
  <>
    {bannerConfig && (
      <NextStepBanner
        message={bannerConfig.message}
        actions={bannerConfig.actions}
        variant={bannerConfig.variant}
      />
    )}

    <EntityDetailUnifiedWithErrorBoundary ... />

    {/* existing dialog */}
  </>
);
```

The `onAction` for the banner's buttons should trigger the same action handlers — for "Start Brew" it calls the entity's state transition, for "Complete Brew" it opens the completion dialog.

**Step 3: Run lint**

Run: `pnpm lint`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/app/(app)/production/brew-logs/[id]/page.tsx
git commit -m "feat: add NextStepBanner to brew log detail page"
```

---

## Task 3: Integrate NextStepBanner into Batch Detail

Wire up the `NextStepBanner` on the batch detail page.

**Files:**
- Modify: `src/app/(app)/production/batches/[id]/page.tsx`

**Step 1: Add banner logic**

The page already fetches batch data including `status`. We need linked brew log count to determine the banner state. Add a query for linked brew logs:

```tsx
import { NextStepBanner } from "@/components/domain/next-step-banner";
import { batchKeys } from "@/lib/query-keys";

// Add query for linked brew logs count:
const { data: linkedBrewLogs } = useQuery({
  queryKey: batchKeys.brewLogs(id),
  queryFn: async () => {
    const { data, error } = await supabase
      .from("brew_log_batches")
      .select("brew_log_id")
      .eq("batch_id", id);
    if (error) throw error;
    return data ?? [];
  },
});

// Banner logic:
function getBatchBannerConfig(batch, linkedBrewLogs, onStartBrewDay, onStartFermentation) {
  if (!batch) return null;

  if (batch.status === "planned" && (!linkedBrewLogs || linkedBrewLogs.length === 0)) {
    return {
      message: "This batch needs a brew. Start a brew day or link an existing brew log.",
      variant: "info" as const,
      actions: [
        { label: "Start Brew Day", onClick: onStartBrewDay },
        { label: "Link Brew", onClick: () => { /* scroll to linker section */ } },
      ],
    };
  }
  if (batch.status === "planned" && linkedBrewLogs && linkedBrewLogs.length > 0) {
    return {
      message: "Brew is linked. Start fermentation when ready.",
      variant: "info" as const,
      actions: [{ label: "Start Fermentation", onClick: onStartFermentation }],
    };
  }
  if (batch.status === "fermenting") {
    return {
      message: "Track fermentation progress with readings and additions.",
      variant: "default" as const,
      actions: [
        { label: "Readings", href: `/production/batches/${batch.id}/readings` },
        { label: "Additions", href: `/production/batches/${batch.id}/additions` },
      ],
    };
  }
  return null;
}
```

The "Start Brew Day" button from the banner will need a `StartBrewDayDialog` integration — the batch knows its `recipe_id`, so we can pass that to the dialog. This requires adding the `StartBrewDayDialog` import and state to this page. The dialog's `onSuccess` should additionally link the new brew log to this batch.

For the batch-from-planned entry point: add a `showStartBrewDay` state + `StartBrewDayDialog` to the page. When triggered from the banner, it opens with the batch's recipe pre-filled. After success, we also need to create the `brew_log_batches` junction record linking the new brew log to this batch.

**Step 2: Render the banner**

Same pattern as Task 2 — render `NextStepBanner` above `EntityDetailUnifiedWithErrorBoundary`.

**Step 3: Add StartBrewDayDialog for the batch entry point**

Import and render `StartBrewDayDialog`. The dialog needs `recipeId` and `recipeName` — fetch these from the batch's recipe relation. After `onSuccess`, also insert a `brew_log_batches` record linking the new brew log to this batch.

```tsx
// Additional state:
const [showStartBrewDay, setShowStartBrewDay] = useState(false);

// Need recipe info for the dialog:
// The batch already has recipe_id from the entity detail query.
// Fetch recipe name:
const { data: recipe } = useQuery({
  queryKey: ["recipe-name", batch?.recipe_id],
  queryFn: async () => {
    if (!batch?.recipe_id) return null;
    const { data, error } = await supabase
      .from("recipes")
      .select("id, name")
      .eq("id", batch.recipe_id)
      .single();
    if (error) throw error;
    return data;
  },
  enabled: !!batch?.recipe_id,
});

// In JSX:
{recipe && (
  <StartBrewDayDialog
    recipeId={recipe.id}
    recipeName={recipe.name}
    open={showStartBrewDay}
    onOpenChange={setShowStartBrewDay}
    onSuccess={async (brewLogId) => {
      // Link the new brew log to this batch
      await supabase.from("brew_log_batches").insert({
        brew_log_id: brewLogId,
        batch_id: id,
        volume_bbl: batch?.volume_bbl ?? 0,
      });
      queryClient.invalidateQueries({ queryKey: batchKeys.brewLogs(id) });
      queryClient.invalidateQueries({ queryKey: batchKeys.detail(id) });
      router.push(`/production/brew-logs/${brewLogId}`);
    }}
  />
)}
```

Note: Need to add `useRouter` import and `const router = useRouter()`.

**Step 4: Run lint**

Run: `pnpm lint`
Expected: No new errors

**Step 5: Commit**

```bash
git add src/app/(app)/production/batches/[id]/page.tsx
git commit -m "feat: add NextStepBanner and Start Brew Day entry point to batch detail"
```

---

## Task 4: Integrated Timeline on Brew Log Detail

Replace the compact `BrewLogTimeline` wrapper with the full interactive `BrewEventTimeline` rendered inline. Remove the separate `/events` page.

**Files:**
- Modify: `src/components/domain/brew-log-timeline.tsx`
- Modify: `src/entities/brew-log.tsx` (section ordering)
- Delete: `src/app/(app)/production/brew-logs/[id]/events/page.tsx`

**Step 1: Modify BrewLogTimeline to always render full timeline**

Remove the compact empty-state view that links to `/events`. Instead, always render the full `BrewEventTimeline` with add/edit/delete capabilities.

```tsx
// In brew-log-timeline.tsx, replace the entire component body:
export function BrewLogTimeline({ data }: BrewLogTimelineProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const events = (data.events as BrewEvent[]) || [];
  const isReadOnly = data.status === "completed" || data.status === "cancelled";

  const updateEventsMutation = useMutation({
    mutationFn: async (newEvents: BrewEvent[]) => {
      const { error } = await supabase
        .from("brew_logs")
        .update({ events: newEvents })
        .eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: brewLogKeys.detail(data.id) });
    },
  });

  const handleAddEvent = async (event: BrewEvent) => {
    await updateEventsMutation.mutateAsync([...events, event]);
  };

  const handleUpdateEvent = async (updatedEvent: BrewEvent) => {
    await updateEventsMutation.mutateAsync(
      events.map((e) => (e.id === updatedEvent.id ? updatedEvent : e))
    );
  };

  const handleDeleteEvent = async (eventId: string) => {
    await updateEventsMutation.mutateAsync(events.filter((e) => e.id !== eventId));
  };

  // Status warning for read-only
  return (
    <div className="space-y-4">
      {isReadOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            This brew log is {data.status}. Events are read-only.
          </p>
        </div>
      )}

      <BrewEventTimeline
        events={events}
        onAddEvent={!isReadOnly ? handleAddEvent : undefined}
        onUpdateEvent={!isReadOnly ? handleUpdateEvent : undefined}
        onDeleteEvent={!isReadOnly ? handleDeleteEvent : undefined}
        readOnly={isReadOnly}
      />
    </div>
  );
}
```

Remove the `Link` import and `Button` import if no longer needed. Remove `Clock` icon import.

**Step 2: Reorder sections in brew-log entity config**

In `src/entities/brew-log.tsx`, reorder the `sections` array so timeline comes right after overview:

```typescript
sections: [
  { id: "overview", ... },      // 1st - stays
  { id: "timeline", ... },      // 2nd - stays (now renders full timeline)
  { id: "batches", ... },       // 3rd - stays
  { id: "notes", ... },         // 4th - stays
],
```

The order is already correct. No change needed here unless it differs.

**Step 3: Delete the events page**

Remove `src/app/(app)/production/brew-logs/[id]/events/page.tsx` and the `events/` directory.

**Step 4: Run lint**

Run: `pnpm lint`
Expected: No new errors

**Step 5: Commit**

```bash
git add -u
git commit -m "feat: integrate full brew event timeline into brew log detail, remove /events page"
```

---

## Task 5: Enhanced BatchBrewInfo with Inline Brew Summary

Replace the current aggregated-metrics-only `BatchBrewInfo` with richer per-brew-log cards showing brewer, measurements, and phase highlights.

**Files:**
- Modify: `src/components/domain/batch-brew-info.tsx`
- Modify: `src/lib/query-keys.ts` (if new key needed)

**Step 1: Extend the brew log query to include events and brewer**

The `BrewLogLinker` already fetches linked brew logs. We need to extend that query or add a parallel query that fetches brew_logs with `events` and `brewer_id` + user profile name.

Add a new query in `BatchBrewInfo` that fetches the full linked brew log data:

```tsx
const { data: linkedBrews = [] } = useQuery({
  queryKey: batchKeys.brewLogs(data.id),
  queryFn: async () => {
    const { data: links, error } = await supabase
      .from("brew_log_batches")
      .select(`
        id, volume_bbl, notes,
        brew_log:brew_logs(
          id, brew_number, brew_date, status, events,
          brewer:user_profiles!brew_logs_brewer_id_fkey(full_name),
          recipe:recipes(name)
        )
      `)
      .eq("batch_id", data.id);
    if (error) throw error;
    return links ?? [];
  },
});
```

**Step 2: Add phase highlight extraction helper**

```tsx
function extractPhaseHighlights(events: BrewEvent[]): { label: string; value: string }[] {
  const highlights: { label: string; value: string }[] = [];

  // Find mash temp
  const mashEvent = events.find(e => e.phase === "mash_in" || e.phase === "mash_rest");
  const mashTemp = mashEvent?.measurements?.find(m => m.metric === "temp_f");
  if (mashTemp) highlights.push({ label: "Mash Temp", value: `${mashTemp.value}°F` });

  // Find pre-boil gravity
  const kettleEvent = events.find(e => e.phase === "kettle_full" || e.phase === "boil_start");
  const preBoilGravity = kettleEvent?.measurements?.find(m => m.metric === "gravity_plato");
  if (preBoilGravity) highlights.push({ label: "Pre-Boil", value: `${preBoilGravity.value}°P` });

  // Find post-boil volume
  const boilEndEvent = events.find(e => e.phase === "boil_end" || e.phase === "ko_end");
  const postBoilVol = boilEndEvent?.measurements?.find(m => m.metric === "volume_bbl");
  if (postBoilVol) highlights.push({ label: "Post-Boil Vol", value: `${postBoilVol.value} BBL` });

  return highlights;
}
```

**Step 3: Render per-brew-log summary cards**

Replace the current aggregated metrics grid + BrewLogLinker with per-brew cards:

```tsx
export function BatchBrewInfo({ data }: BatchBrewInfoProps) {
  // ... query from step 1 ...

  return (
    <div className="space-y-4">
      {linkedBrews.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No brew logs linked yet.
        </p>
      ) : (
        linkedBrews.map((link) => {
          const brew = link.brew_log;
          const events = (brew.events as BrewEvent[]) || [];
          const highlights = extractPhaseHighlights(events);

          return (
            <div key={link.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Link href={`/production/brew-logs/${brew.id}`} className="font-medium hover:text-primary transition-colors">
                  {brew.brew_number}
                </Link>
                <Badge variant="outline">
                  <UnitDisplay value={link.volume_bbl} unitType="volume" />
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Brew Date</span>
                  <span className="ml-2">{new Date(brew.brew_date).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Brewer</span>
                  <span className="ml-2">{brew.brewer?.full_name ?? "—"}</span>
                </div>
                {data.actual_og && (
                  <div>
                    <span className="text-muted-foreground">Actual OG</span>
                    <span className="ml-2">{data.actual_og.toFixed(1)}°P</span>
                  </div>
                )}
              </div>

              {/* Phase highlights */}
              {highlights.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {highlights.map((h) => (
                    <Badge key={h.label} variant="secondary" className="text-xs font-normal">
                      {h.label}: {h.value}
                    </Badge>
                  ))}
                </div>
              )}

              {link.notes && (
                <p className="text-sm text-muted-foreground italic">{link.notes}</p>
              )}
            </div>
          );
        })
      )}

      {/* BrewLogLinker for managing links — collapsible */}
      <details className="group">
        <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
          Manage linked brew logs
        </summary>
        <div className="mt-3">
          <BrewLogLinker batchId={data.id} batchName={`${data.batch_number} - ${data.name}`} />
        </div>
      </details>
    </div>
  );
}
```

**Step 4: Run lint**

Run: `pnpm lint`
Expected: No new errors

**Step 5: Commit**

```bash
git add src/components/domain/batch-brew-info.tsx
git commit -m "feat: rich inline brew summary with phase highlights on batch detail"
```

---

## Task 6: Add "Start Brew Day" to Brew Logs List Page

Add a primary action button to the brew logs list that opens the `StartBrewDayDialog` with a recipe selector.

**Files:**
- Modify: `src/app/(app)/production/brew-logs/page.tsx`
- Modify: `src/components/domain/start-brew-day-dialog.tsx` (make `recipeId` optional, add recipe selector as step 0)

**Step 1: Add recipe selector step to StartBrewDayDialog**

Make `recipeId` and `recipeName` optional. When not provided, show a "Step 0" with a recipe selector dropdown before the existing steps.

```tsx
// Update props interface:
interface StartBrewDayDialogProps {
  recipeId?: string;       // Now optional
  recipeName?: string;     // Now optional
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (brewLogId: string) => void;
}

// Add state for selected recipe when no recipeId prop:
const [selectedRecipeId, setSelectedRecipeId] = useState(recipeId ?? "");
const [selectedRecipeName, setSelectedRecipeName] = useState(recipeName ?? "");

// Use effective values:
const effectiveRecipeId = recipeId ?? selectedRecipeId;
const effectiveRecipeName = recipeName ?? selectedRecipeName;

// If no recipeId prop, step count is 4 (0-indexed from step 0)
const hasRecipeSelector = !recipeId;
const totalSteps = hasRecipeSelector ? 4 : 3;
const adjustedStep = hasRecipeSelector ? step : step + 1; // normalize for display

// Add recipe query for the selector:
const { data: recipes = [] } = useQuery({
  queryKey: entityKeys.list("recipes"),
  queryFn: async () => {
    const { data, error } = await db
      .from("recipes")
      .select("id, name, style_name")
      .eq("status", "complete")
      .order("name");
    if (error) throw error;
    return data;
  },
  enabled: open && hasRecipeSelector,
});

// Render Step 0 (recipe selector):
const renderStep0 = () => (
  <div className="space-y-4">
    <div className="space-y-2">
      <Label>Select Recipe</Label>
      <Select value={selectedRecipeId} onValueChange={(val) => {
        setSelectedRecipeId(val);
        const recipe = recipes.find(r => r.id === val);
        setSelectedRecipeName(recipe?.name ?? "");
      }}>
        <SelectTrigger>
          <SelectValue placeholder="Choose a recipe..." />
        </SelectTrigger>
        <SelectContent>
          {recipes.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name} {r.style_name ? `(${r.style_name})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  </div>
);
```

Update step rendering, navigation, and validation to account for the optional step 0.

**Step 2: Add brewer default to current user in step 1**

In the StartBrewDayDialog, after the brew log insert, also set the `brewer_id`:

```tsx
// At top of component, fetch current user:
const { data: userData } = useQuery({
  queryKey: ["current-user"],
  queryFn: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },
  enabled: open,
});

// In the brew log insert, add brewer_id:
const { data: brewLog, error: brewLogError } = await db
  .from("brew_logs")
  .insert({
    brew_number: brewNumber.trim(),
    brew_date: brewDate,
    recipe_id: effectiveRecipeId,
    brewer_id: userData?.id ?? null,
    status: "draft",
  })
  .select("id")
  .single();
```

**Step 3: Update brew logs list page to include Start Brew Day button**

```tsx
// src/app/(app)/production/brew-logs/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EntityList } from "@/components/universal/entity-list";
import { brewLogEntity } from "@/entities/brew-log";
import { StartBrewDayDialog } from "@/components/domain/start-brew-day-dialog";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

export default function BrewLogsPage() {
  const router = useRouter();
  const [showStartBrewDay, setShowStartBrewDay] = useState(false);

  return (
    <>
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setShowStartBrewDay(true)}>
            <Play className="h-4 w-4 mr-2" />
            Start Brew Day
          </Button>
        </div>
        <EntityList
          entity={brewLogEntity}
          basePath="/production/brew-logs"
        />
      </div>

      <StartBrewDayDialog
        open={showStartBrewDay}
        onOpenChange={setShowStartBrewDay}
        onSuccess={(brewLogId) => {
          setShowStartBrewDay(false);
          router.push(`/production/brew-logs/${brewLogId}`);
        }}
      />
    </>
  );
}
```

Note: Check how EntityList renders its header. If it already has a header row with a "New" button, place the "Start Brew Day" button adjacent to it using `onCreateClick` or similar pattern. If EntityList doesn't support header customization, use the wrapper approach shown above.

**Step 4: Run lint**

Run: `pnpm lint`
Expected: No new errors

**Step 5: Commit**

```bash
git add src/components/domain/start-brew-day-dialog.tsx src/app/(app)/production/brew-logs/page.tsx
git commit -m "feat: add Start Brew Day entry point to brew logs list with recipe selector"
```

---

## Task 7: Brew Completion Wizard (3-Step)

Replace the single-step `BrewLogCompletionDialog` with a 3-step wizard: Review Measurements → Assign Vessels → Confirm & Complete. After completion, navigate to the batch detail page.

**Files:**
- Modify: `src/components/domain/brew-log-completion-dialog.tsx`
- Modify: `src/app/(app)/production/brew-logs/[id]/page.tsx` (add router.push on success)

**Step 1: Restructure the dialog into 3 steps**

Add step state management (same pattern as `StartBrewDayDialog`):

```tsx
const [step, setStep] = useState(1);

// Step 1 needs brew log events
// Extend the existing query or add a new one:
const { data: brewLogFull } = useQuery({
  queryKey: brewLogKeys.detail(brewLogId),
  queryFn: async () => {
    const { data, error } = await db
      .from("brew_logs")
      .select("id, brew_number, status, events")
      .eq("id", brewLogId)
      .single();
    if (error) throw error;
    return data;
  },
  enabled: open,
});

// Extract key measurements for review:
function extractKeyMeasurements(events) {
  const measurements = [];
  // Post-boil OG
  const boilEnd = events.find(e => e.phase === "boil_end" || e.phase === "ko_start");
  const og = boilEnd?.measurements?.find(m => m.metric === "gravity_plato");
  if (og) measurements.push({ label: "Post-Boil OG", value: og.value, unit: "°P", metric: "gravity_plato" });

  // Post-boil volume
  const vol = boilEnd?.measurements?.find(m => m.metric === "volume_bbl");
  if (vol) measurements.push({ label: "Post-Boil Volume", value: vol.value, unit: "BBL", metric: "volume_bbl" });

  // KO temp
  const koEnd = events.find(e => e.phase === "ko_end");
  const temp = koEnd?.measurements?.find(m => m.metric === "temp_f");
  if (temp) measurements.push({ label: "Knockout Temp", value: temp.value, unit: "°F", metric: "temp_f" });

  return measurements;
}
```

**Step 2: Add step indicators and navigation**

Same progress bar pattern as `StartBrewDayDialog`:

```tsx
// Step indicators
<div className="flex items-center gap-1 px-1">
  {[1, 2, 3].map((s) => (
    <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? "bg-primary" : "bg-muted"}`} />
  ))}
</div>

// Step titles
const stepTitles = ["Review Measurements", "Assign Vessels", "Confirm & Complete"];
```

**Step 3: Render Step 1 (Review Measurements)**

Display extracted measurements in an editable grid. Each measurement is a labeled value that can be edited inline.

```tsx
const renderStep1 = () => {
  const events = (brewLogFull?.events as BrewEvent[]) || [];
  const keyMeasurements = extractKeyMeasurements(events);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Review the key measurements from your brew day before completing.
      </p>
      {keyMeasurements.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No key measurements recorded. You can proceed to vessel assignment.
        </p>
      ) : (
        <div className="grid gap-3">
          {keyMeasurements.map((m) => (
            <div key={m.label} className="flex items-center justify-between p-3 rounded-md border">
              <span className="text-sm font-medium">{m.label}</span>
              <span className="text-sm">{m.value} {m.unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

**Step 4: Step 2 is the existing vessel assignment UI**

Move the existing `linkedBatches` + vessel assignment rendering into `renderStep2()`.

**Step 5: Render Step 3 (Confirm & Complete)**

Show a summary of what will happen:

```tsx
const renderStep3 = () => (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground">
      Review and confirm the following actions:
    </p>
    <div className="p-4 rounded-md border space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Brew Log</span>
        <span className="font-medium">{brewNumber} → Completed</span>
      </div>
      {linkedBatches.map((batch) => {
        const vesselId = vesselAssignments[batch.id] || batch.current_vessel_id;
        const vessel = vesselId
          ? availableVessels.find(v => v.id === vesselId)
          : null;
        const vesselName = vessel?.name || batch.current_vessel_name || "—";
        return (
          <div key={batch.id} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{batch.batch_number}</span>
            <span className="font-medium">→ Fermenting in {vesselName}</span>
          </div>
        );
      })}
    </div>
  </div>
);
```

**Step 6: Auto-suggest vessel by capacity fit**

In step 2, sort available vessels by best fit (closest capacity to batch volume, preferring vessels where capacity >= volume):

```tsx
const getAvailableVesselsForBatch = useCallback((batchId: string) => {
  // ... existing exclusion logic ...
  const batch = linkedBatches.find(b => b.id === batchId);
  const targetVolume = batch?.link_volume_bbl ?? batch?.volume_bbl ?? 0;

  return filteredVessels.sort((a, b) => {
    const aFit = (a.capacity_bbl ?? Infinity) - targetVolume;
    const bFit = (b.capacity_bbl ?? Infinity) - targetVolume;
    // Prefer positive fits (vessel >= volume), then closest fit
    if (aFit >= 0 && bFit < 0) return -1;
    if (aFit < 0 && bFit >= 0) return 1;
    return Math.abs(aFit) - Math.abs(bFit);
  });
}, [...]);
```

Show capacity utilization next to each vessel option:

```tsx
<SelectItem key={v.id} value={v.id}>
  {v.name}
  {v.capacity_bbl && targetVolume ? (
    <> ({Math.round((targetVolume / v.capacity_bbl) * 100)}% full)</>
  ) : v.capacity_bbl ? (
    <> (<UnitDisplay value={v.capacity_bbl} unitType="volume" />)</>
  ) : ""}
</SelectItem>
```

**Step 7: Navigate to batch after completion**

In the brew log detail page (`[id]/page.tsx`), update the `onSuccess` handler to navigate to the first linked batch:

```tsx
const handleDialogSuccess = useCallback((navigateToBatchId?: string) => {
  queryClient.invalidateQueries({ queryKey: brewLogKeys.detail(id) });
  queryClient.invalidateQueries({ queryKey: entityKeys.detail("brew_logs", id) });
  if (navigateToBatchId) {
    router.push(`/production/batches/${navigateToBatchId}`);
  }
}, [queryClient, id, router]);
```

Update `BrewLogCompletionDialog` to pass the first batch ID back via `onSuccess`:

```tsx
// Update props:
onSuccess: (batchId?: string) => void;

// In handleSubmit, after all operations succeed:
const firstBatchId = linkedBatches[0]?.id;
onSuccess(firstBatchId);
```

**Step 8: Run lint**

Run: `pnpm lint`
Expected: No new errors

**Step 9: Commit**

```bash
git add src/components/domain/brew-log-completion-dialog.tsx src/app/(app)/production/brew-logs/[id]/page.tsx
git commit -m "feat: 3-step brew completion wizard with measurement review and forward navigation"
```

---

## Task 8: Cross-Navigation Breadcrumb

Add a contextual breadcrumb showing the Recipe → Brew Log → Batch chain on both brew log and batch detail pages.

**Files:**
- Create: `src/components/domain/brew-journey-breadcrumb.tsx`
- Modify: `src/app/(app)/production/brew-logs/[id]/page.tsx`
- Modify: `src/app/(app)/production/batches/[id]/page.tsx`

**Step 1: Create the breadcrumb component**

```tsx
// src/components/domain/brew-journey-breadcrumb.tsx
"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface BreadcrumbSegment {
  label: string;
  href?: string; // undefined = current page (non-clickable)
}

interface BrewJourneyBreadcrumbProps {
  segments: BreadcrumbSegment[];
}

export function BrewJourneyBreadcrumb({ segments }: BrewJourneyBreadcrumbProps) {
  if (segments.length <= 1) return null;

  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {segments.map((segment, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
          {segment.href ? (
            <Link href={segment.href} className="hover:text-foreground transition-colors">
              {segment.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium">{segment.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
```

**Step 2: Add breadcrumb to brew log detail page**

Fetch recipe name and linked batches (already available from Task 2). Build segments:

```tsx
const segments: BreadcrumbSegment[] = [];

// Recipe (if available)
if (brewLog?.recipe_id && recipeName) {
  segments.push({ label: recipeName, href: `/production/recipes/${brewLog.recipe_id}` });
}

// Current brew log (non-clickable)
segments.push({ label: brewLog?.brew_number ?? "Brew Log" });

// First linked batch (if available)
if (linkedBatches?.length === 1) {
  // Need batch_number — extend the linkedBatches query to include batch_number
  segments.push({ label: batchNumber, href: `/production/batches/${linkedBatches[0].batch_id}` });
}
```

Render above the NextStepBanner.

Note: The brew log detail page query needs to include `recipe_id` in the select. Also need recipe name — add a small query or extend existing. The linked batches query from Task 2 needs to be extended to include batch_number.

**Step 3: Add breadcrumb to batch detail page**

The batch page already has recipe info from Task 3 and linked brew logs. Build segments:

```tsx
const segments: BreadcrumbSegment[] = [];

if (recipe) {
  segments.push({ label: recipe.name, href: `/production/recipes/${recipe.id}` });
}

// Primary brew log (highest volume)
if (linkedBrewLogs?.length > 0) {
  // Need brew_number — extend query to include brew log details
  segments.push({ label: primaryBrewNumber, href: `/production/brew-logs/${primaryBrewLogId}` });
}

// Current batch
segments.push({ label: batch?.batch_number ?? "Batch" });
```

**Step 4: Run lint**

Run: `pnpm lint`
Expected: No new errors

**Step 5: Commit**

```bash
git add src/components/domain/brew-journey-breadcrumb.tsx src/app/(app)/production/brew-logs/[id]/page.tsx src/app/(app)/production/batches/[id]/page.tsx
git commit -m "feat: add contextual breadcrumb navigation for Recipe → Brew Log → Batch journey"
```

---

## Task 9: Add "Brew Log" Quick Link to BatchQuickLinks

Add a 4th quick link to `BatchQuickLinks` that navigates to the linked brew log.

**Files:**
- Modify: `src/components/domain/batch-quick-links.tsx`

**Step 1: Update the component to accept brew log info and conditionally render the link**

```tsx
interface BatchQuickLinksProps {
  data: {
    id: string;
    brew_log_id?: string | null;
    brew_log_number?: string | null;
  };
}

export function BatchQuickLinks({ data }: BatchQuickLinksProps) {
  const links = [
    // ... existing 3 links ...
  ];

  // Add brew log link if available
  if (data.brew_log_id) {
    links.unshift({
      href: `/production/brew-logs/${data.brew_log_id}`,
      label: "Brew Log",
      description: data.brew_log_number ?? "View hot-side brewing details",
      icon: Beer, // from lucide-react
    });
  }

  return (
    <div className={`grid gap-3 ${links.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
      {/* ... same rendering ... */}
    </div>
  );
}
```

The `brew_log_id` and `brew_log_number` props need to come from the batch data. The `BatchQuickLinks` component receives `data` from the entity detail. We'll need to either:
- Extend the `batches_with_brew_info` view to include the primary brew log ID and number, OR
- Fetch it client-side inside the component

The simpler approach is to fetch client-side inside the component using the `batchKeys.brewLogs(data.id)` query (which may already be cached from `BatchBrewInfo`).

```tsx
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { batchKeys } from "@/lib/query-keys";

// Inside component:
const supabase = createClient();
const { data: brewLogLinks } = useQuery({
  queryKey: batchKeys.brewLogs(data.id),
  queryFn: async () => {
    const { data: links, error } = await supabase
      .from("brew_log_batches")
      .select("brew_log_id, brew_log:brew_logs(brew_number)")
      .eq("batch_id", data.id)
      .limit(1);
    if (error) throw error;
    return links ?? [];
  },
});

const primaryBrewLog = brewLogLinks?.[0];
```

**Step 2: Run lint**

Run: `pnpm lint`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/components/domain/batch-quick-links.tsx
git commit -m "feat: add Brew Log quick link to batch detail navigation"
```

---

## Task Dependency Order

Tasks can be executed mostly in parallel since they touch different files:

- **Task 1** (NextStepBanner) — no dependencies, foundation component
- **Task 2** (Banner on brew log) — depends on Task 1
- **Task 3** (Banner on batch) — depends on Task 1
- **Task 4** (Integrated timeline) — independent
- **Task 5** (BatchBrewInfo) — independent
- **Task 6** (Start Brew Day on list) — independent
- **Task 7** (Completion wizard) — independent
- **Task 8** (Breadcrumb) — depends on Tasks 2 and 3 (same files)
- **Task 9** (Quick link) — independent

**Recommended execution order:** 1 → 4 → 5 → 6 → 9 → 2 → 3 → 7 → 8

This order minimizes merge conflicts by completing independent tasks first, then layering in the page-level integrations (Tasks 2, 3, 7, 8) which all modify the same detail page files.
