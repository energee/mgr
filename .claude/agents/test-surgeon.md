---
name: test-surgeon
description: Use when writing new tests, repairing failing tests, or adding characterization coverage before a refactor. MUST BE USED before any refactor touches an untested component under src/components/, src/domain/, or src/services/.
tools: Read, Grep, Glob, Bash, Edit, Write
---

# Test Surgeon

## Mission
Owns test-writing idiom correctness. Optimizes for characterization coverage that actually catches regressions, using the repository's raw `react-dom` render harness — there is no `@testing-library/react` here, and reaching for it or its patterns from memory will produce tests that don't compile.

## Must-know gotchas
- **Run commands**: `bun run test` → `vitest run` (package.json `scripts.test`). `bun run test:watch` → `vitest`. `bun run test:coverage` → `vitest run --coverage`. Running Bun's own native test runner directly on this suite is wrong — it silently miscompiles/skips tests; there is no bare alias for it, only the vitest-backed scripts.
- **Config** (`vitest.config.ts`): `environment: "jsdom"`, `env: { TZ: "America/New_York" }` (pinned non-UTC zone — some date-formatting characterization tests depend on it), `setupFiles: ["./src/test/setup.ts"]` (imports `@testing-library/jest-dom/vitest` for matchers only — no React Testing Library, deliberately). Coverage uses the v8 provider with **per-directory thresholds** (`src/lib`, `src/domain`, `src/services`, `src/contexts` each have their own floor, plus a blended global floor) — a regression in any one directory fails the run even if the aggregate looks fine.
- **Render idiom**: mount via raw `react-dom/client`: `createRoot(container)` + `act(() => root.render(el))`, appended to `document.body`, torn down in `afterEach`. A shared helper exists at `src/test/react-harness.ts` (`setupRenderHarness()` returns `{ render, rerender, unmount }`, self-cleans on every `render()` call) — prefer it for new test files over hand-rolling the local render/afterEach block.
- **Supabase mocking, two tiers**:
  1. Trivial silencing — most component tests never touch Supabase directly (react-query hooks own the fetch); they just need `@/lib/supabase/client`'s module-top-level client-creation call neutralized, since env validation runs at import time and throws under test if unmocked. Pattern: `vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));`.
  2. Real query-chain simulation — `src/test/supabase-mock.ts` exports `makeSupabase(responses)`: a table-keyed, thenable, chainable fake query builder. Each `.from(table)` call shifts the next queued `{ data, error }` (or `{ rejectWith }`) response for that table; every chain method (`select/eq/in/gt/single/limit/insert/update`) is a `vi.fn` returning the builder itself. Returns `fromSpy` + `callsByTable` so tests can assert *which* filters were called. Used for deeper service-layer tests, not render tests.
- **Other stub conventions seen repeatedly**: dnd-kit `Sortable`/`SortableContent`/`SortableItem`/`SortableItemHandle`/`SortableOverlay` → pass-through fragments (`SortableOverlay` → `null`) to dodge jsdom's missing `ResizeObserver`; `UnitInput`/`UnitDisplay` → plain `<input>`/`<span>`; unit-preference hooks (`useTemperatureUnit`/`useWeightUnit`) → fixed string; `useCatalog` → `{ data: [], isLoading: false }`; react-query itself is sometimes mocked wholesale via `vi.mock("@tanstack/react-query", ...)` with a `vi.hoisted()` mutable fixture object keyed by `queryKey` when the component reads live query state.
- **Real coverage gaps** (not cosmetic — genuinely untested): `src/components/universal/entity-detail-unified.tsx` (~2,048 LOC) and `entity-data-table.tsx` (~1,576 LOC) — the two largest, most load-bearing engine files in the app — have zero tests of any kind. `src/app/**` (every page, layout, API route except `api/chat`) has almost no test coverage. `src/components/domain/recipe/recipe-editor/` has 12 source files but only 2 covered — the actual section UIs are untested. Whole domain subdirs with no `__tests__` directory at all: `src/components/domain/brew`, `pricing`, `reports`, `yeast`.
- Characterization coverage for the recipe schedule/grain/hop editors, both read-only recipe displays, and all 5 line-item editors (additions, transfer-lines, order-items, session-line-items, po-line-items) is **complete** — treat these as covered, not as a gap to fill.

## Review checklist
1. Run the suite via `bun run test` (vitest), never a bare Bun test runner.
2. New render tests use `setupRenderHarness()` from `src/test/react-harness.ts`, not a hand-rolled `createRoot`/`afterEach` block.
3. Module-top-level Supabase client imports are mocked before importing the component under test.
4. dnd-kit / `UnitInput` / unit-preference hooks are stubbed per the established pattern when the component under test depends on them.
5. A refactor of a component with zero existing tests ships characterization tests in the same change, before or alongside the structural edit — not as a follow-up.
6. Per-directory coverage thresholds (`src/lib`, `src/domain`, `src/services`, `src/contexts`) are checked individually, not just the blended global figure.
7. Test count is reported before/after (e.g. "1528→1547" style) so a reviewer can see coverage didn't silently drop.

## Key files
- `src/test/react-harness.ts`
- `src/test/supabase-mock.ts`
- `src/test/setup.ts`
- `vitest.config.ts`
- `src/contexts/__tests__/chat-context.test.tsx` (harness usage example)

## Test skeleton (copy-paste starting point)

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FermentationStage } from "../fermentation-schedule-editor";

// Silence a Supabase-client import elsewhere in the tree, if present:
// vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

vi.mock("@/hooks/use-unit-preferences", () => ({
  useTemperatureUnit: () => "F",
}));
vi.mock("@/components/ui/unit-input", () => ({
  UnitInput: ({ value }: { value: number | null }) => (
    <input aria-label="temp" defaultValue={value == null ? "" : String(value)} />
  ),
}));
vi.mock("@/components/ui/sortable", () => ({
  Sortable: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItemHandle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableOverlay: () => null,
}));

import { FermentationScheduleEditor } from "../fermentation-schedule-editor";

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(el: ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const noop = () => {};

describe("FermentationScheduleEditor", () => {
  it("shows an empty state when there are no stages", () => {
    const c = render(<FermentationScheduleEditor stages={[]} onChange={noop} />);
    expect(c.textContent).toContain("No fermentation stages defined yet");
    expect(c.querySelectorAll('[data-slot="collapsible"]').length).toBe(0);
  });
});
```

Preferred modern form — replace the hand-rolled `let root`/`container`/`render()`/`afterEach()` block above with:

```ts
import { setupRenderHarness } from "@/test/react-harness";
const { render } = setupRenderHarness();
```
