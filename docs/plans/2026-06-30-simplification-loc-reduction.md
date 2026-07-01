# Simplification & LOC Reduction Plan

**Date:** 2026-06-30
**Branch / worktree:** `worktree-simplify` (`.claude/worktrees/simplify`)
**Method:** 24-agent codebase audit (map → 6-dimension audit → adversarial cut-safety verification). Every LOC number below is `wc -l`-grounded; every "safe to delete" claim was verified by grep against keep-list code and the migration/schema graph.

---

## 1. Baseline

| Surface | LOC | Files |
|---|---|---|
| `src` (TS/TSX) | **153,564** | ~909 |
| ├ `components` | 69,644 | 319 |
| ├ `app` (routes) | 27,628 | 263 (134 `page.tsx`) |
| ├ `entities` | 14,944 | 131 |
| ├ `lib` | 13,565 | 68 |
| ├ `types` (`supabase.ts` = 10,600 generated) | 11,826 | 5 |
| ├ `domain` | 5,321 | 33 |
| ├ `integrations` | 4,554 | 26 |
| └ hooks/services/contexts | ~6,000 | — |
| `supabase/migrations` (schema history, not runtime) | 27,154 | 165 |

**Keep-list** (the only features that must remain): purchase orders, suppliers, raw materials + inventory, recipes, batches + readings/additions + brew logs, cellar/vessel transfers, products (selling-formats) + pricing, packaging sessions, finished goods, orders, customers.

---

## 2. Headline speculation

> **`src` can go from ~153.5k → ~100–105k LOC** — a **~one-third reduction (~48–52k LOC)** — without losing any keep-list capability. Cutting the (optional, not-in-scope) AI chat assistant takes it to **~98–100k**.
>
> **Screens: 134 → ~20 `page.tsx` (~85% fewer).**
> **Migrations: 165 files / 27k LOC → squash to ~1 baseline (~3k).**
> **Dependencies: drop 3 (`mongodb`, `uuid`, `square`).**

Two independent estimates agree: bottom-up (sum of keep-list footprints + retained infrastructure ≈ 95–100k) and top-down (baseline − verified cuts ≈ 102–108k).

---

## 3. Ranked cuts (biggest first, verified safe LOC)

| # | Cut | Safe LOC | Type | Notes |
|---|---|---:|---|---|
| 1 | **Reports** — 7 pages + report/ttb/cogs utils | 6,574 (+759 tests) | ✅ clean | One-directional; zero keep imports. Keep TTB+Batch-Cost only if you file TTB. |
| 2 | **Integrations** — QuickBooks + MongoDB + Square | 7,231 | ✅ clean | Drops deps `mongodb`,`uuid`,`square`. **Retain** `customers.is_tax_exempt`/`payment_terms_days` (QBO migration added them but they're keep). |
| 3 | **AI chat assistant** *(optional — not in keep-list)* | 4,733 | ✅ clean | One-directional. Decision point — see §6. |
| 4 | **Yeast-pitch management** — pitches/events/brinks/lineage/viability + `yeast-calculations.ts` | 4,024 | ✅ clean* | **Retain the `yeasts` catalog** (`recipes.yeast_id` RESTRICT). *Mechanical edits to batch entity + registry. |
| 5 | **Production planning** — backward-planner, timeline, demand, material-planning | 4,064 | ⚠️ delete+trim | **Do NOT delete `consumption-planning.ts` or the BOM hooks** — they're keep-list packaging/transfer math, just mislabeled "planning". |
| 6 | **Kegs** — inventory/owners/transactions | ~2,080 | 🔧 refactor | **Wired into keep flows:** packaging-completion RPC (00184) + order-fulfillment trigger (00183) write the keg ledger; customer detail renders keg balances. Refactor, not delete. |
| 7 | **Customer portal** — `app/portal` + `components/portal` | 1,804 | ✅ clean* | *5 trivial keep-side edits (app-shell redirect, customer "Send Invite" action). Change-request **review** tab stays inert. |
| 8 | **Bins / locations / location-transfers** | 1,781 | 🔧 refactor | `vessels.location_id` (keep) + FG "Location Breakdown" depend on it. `location-transfers` (~1,086) is a clean sub-delete. |
| 9 | **Pick-lists** — entity + UI + `generate_pick_list` RPC | 1,715 | ✅ clean | Order lifecycle is driven by manual transitions, not pick-lists. Keep shared `scan-input` (purchasing uses it). |
| 10 | **Water profiles / chemistry** — `water-chemistry.ts` + recipe water section | 1,622 | ⚠️ delete+trim | Recipe editor threads it; strip water subsections, keep "Other Additions". |
| 11 | **Notifications** — bell + page + cron/bulk RPCs | ~1,300 | ✅ clean | ~4 importers, none in keep domains. Verify no required notification trigger first. |
| 12 | **Allocations — order-allocation FIFO UI only** | ~1,096 | ⚠️ trim | **The `allocations` ledger itself STAYS — see §4.** Only the standalone order-allocation browse UI is removable. |
| 13 | **Deliveries** — entity + routes | 411 | ✅ clean | Drop `orders.delivery_id` + order "delivery" relation. Keep the "Schedule Delivery" action (writes `scheduled_date`, unrelated). |
| | **Subtotal — feature deletions** | **~28,700** (+ ~4,700 AI chat) | | |
| 14 | **Generated `supabase.ts` regen** after table drops | **−3,782** | ✅ free | 34 tables + 24 views vanish on `supabase gen types`. No authoring. |
| 15 | **Within-kept dead code** — `enums.ts` (282 dead), unused `supplier-catalog-section.tsx` (589), zero-importer sweep, `compose-refs` | ~1,200 | ✅ clean | knip + grep verified. **No unused npm deps** except the 3 freed by integration cuts. |
| 16 | **components/domain dedup** — 4 recipe editors → 1 `SortableRowsEditor`; 5 line-item editors → 1 `LineItemsGrid`; read-only displays reuse editors | ~2,000 | ⚠️ refactor | Quality cut, no feature loss. |
| 17 | **UX route restructuring** (§5) | ~4,400 | ⚠️ refactor | Net-new beyond the route deletes already counted above. |
| | **TOTAL `src` reduction** | **~45–50k** (no AI chat) / **~50–54k** (with) | | **→ ~100–105k LOC** |

\* = clean delete but with a handful of mechanical keep-side edits (remove a relation block, a nav line, a registry entry). None remove keep functionality.

---

## 4. Critical correctness caveats — what the names get WRONG

The audit's highest-value output: **three "obvious cuts" are traps.** Verified high-confidence.

1. **`allocations` is NOT order-allocations.** Per its own migration header (`00010` "DEC-HP-001: Polymorphic allocations for ALL inventory movements") it is the **unified inventory-movement / depletion / loss ledger** and the *computed source of every raw-material `remaining_quantity` and every finished-good `available_quantity`* (views `inventory_lots_with_quantities`, `finished_goods_with_availability`). **26 keep-list files** read those views; brew consumption, packaging completion, batch loss/TTB, quick depletions, and FG commitments all write it. **`safeReductionLoc = 0`** for a subsystem cut — only the standalone order-allocation FIFO *UI* (~1,096) is removable. Cutting the ledger = multi-week rebuild of inventory tracking. **Keep it.**

2. **Kegs are wired into packaging + orders.** `session_line_items.keg_owner_id` and `order_items.keg_owner_id` are live keep-table columns; the packaging-completion RPC (`00184:213`) and an order-fulfillment trigger (`00183:305`) both write `keg_transactions`. Removal is a staged refactor (drop columns + XOR constraints, rewrite the RPC keg branch, drop the trigger), not `rm -rf`.

3. **"Planning" hides keep-list math.** `consumption-planning.ts` (`computeBomConsumption`/`computePackagingLoss`/`computeTransferLoss`) and `use-material-planning.ts`'s BOM hooks back **packaging completion and vessel transfers** (keep). Only `backward-planner` + the demand/shortfall hooks are cuttable.

**Also keep, despite appearing on a cut list:**
- **`yeasts` catalog** — `recipes.yeast_id` + `recipe_yeasts` (ON DELETE RESTRICT). Cut the *pitches*, keep the *catalog*.
- **Product taxonomy** (brand / container / beer-style / sales-channel) — NOT NULL / RESTRICT FKs from orders, finished-goods, selling-formats, pricing. `safeReductionLoc = 0`. Only *consolidate the 4 settings pages*, keep the entities.
- **A minimal `locations`** — `vessels.location_id` FKs it.
- **The entity-config engine** (`entities/cores.ts`, `components/universal`, `data-table`, ~12k LOC). It **earns its keep**: 34 list pages + 57 detail pages render through it; hand-writing 39 CRUD screens at parity would be *more* LOC. Collapsing it is LOC-negative. It's also *why the cuts are cheap* — each cut entity is a directory-delete + one registry line. Trim ~1,200 LOC of internal over-engineering (dead `EntityFieldDef`/`EntityDialogConfig` types, deprecated `fetchOptions` dual-path), don't collapse it.

---

## 5. UX: drastically simpler (134 screens → ~20)

**Today:** 7-section collapsible sidebar (~35 links) the cmd+K palette mirrors; every entity ships `list + /new + /[id]` (+ `/edit`, + child routes) → 31 `/new` + 33 `/[id]` + 44 settings pages.

**Proposed flat IA — 9 destinations + Settings/Help footer:**
`Home · Recipes · Batches · Packaging · Inventory · Purchasing · Orders · Customers · Products · Reports`

| Move | Effect |
|---|---|
| 3 dashboards → 1 **Home** with KPI cards | −970, drops a whole nav section |
| 7 nav sections → 1 flat list | −220, deletes Collapsible/openSections machinery |
| **Inline create/edit** (Sheet over the list) → delete 32 `/new`+`/edit` route files | −840, removes a nav hop per entity (biggest UX win) |
| **Master-detail**: child routes (`/[id]/readings`, `/additions`) → detail tabs | −900 |
| Fold **vessels + transfers + brew-logs** into Batches tabs | −600, 8 production links → ~3 |
| Reports 8 → 2 pages | (counted in §3) |
| Settings 44 → ~5 tabs; **move product taxonomy/pricing into `/products`** | −1,500 |
| Delete portal + notifications routes | (counted in §3) |

`src/app`: **27,628 → ~8–10k.**

---

## 6. Open decisions (gate execution)

1. **AI chat assistant** — keep (it's the generic-CRUD-via-chat lever) or cut (−4,733, not in keep-list)?
2. **Reports** — cut all 7, or keep TTB (regulatory filing) + Batch-Cost?
3. **Notifications** — keep a minimal bell, or cut entirely?
4. **Scope of this effort** — deletions only (Phases A–B), or also the within-kept dedup + UX restructuring (Phases C–D)?

---

## 7. Phased execution roadmap

Ordered by risk/independence so each phase ships green (`bun lint && bun typecheck && bun test`) on its own.

- **Phase A — Clean severable deletes (low risk, ~+19k LOC, no keep refactor):** reports, integrations (qbo/mongo/square + 3 deps), pick-lists, portal, deliveries, notifications, within-kept dead code, AI chat (if §6.1 = cut). Each = delete owned files + remove nav/registry/query-key lines + one forward drop-migration. Regenerate `supabase.ts` (−3,782 free).
- **Phase B — Delete-plus-trim (med risk, ~+10k):** yeast-pitch (retain `yeasts`), production planning (retain consumption-planning + BOM hooks), water profiles (trim recipe editor). Surgical edits to keep files, well-documented above.
- **Phase C — Refactor-gated cuts (high risk, ~+5k):** kegs (rewrite packaging RPC + drop order trigger + keep-table columns), bins/locations (recreate `vessels_with_batch` w/o locations join, drop FG bin-breakdown), order-allocation UI trim (ledger stays). Stage last; each needs a tested migration.
- **Phase D — Quality (med risk, ~+6k):** `SortableRowsEditor` + `LineItemsGrid` extraction, read-only displays reuse editors, entity-engine internal trim, UX route restructuring (inline sheets, master-detail, flat nav).
- **Phase E — Schema squash:** after all drop-migrations are applied to every environment, squash 165 migrations → 1 baseline (~3k). Tag the pre-squash chain.

**Net target: `src` ~153.5k → ~100–105k; screens 134 → ~20; deps −3; migrations 165 → ~1.**
