# UX Audit Fixes — Data Entry & Entity Workflows

Source: multi-agent UX audit (2026-06-12) of data-entry and entity workflows. 58 raw
findings from six area explorers were deduplicated to 39, each adversarially verified
against the code (all 39 confirmed), plus 5 additions from a completeness critic — 44 total.
All are implemented on branch `fix/audit-findings`.

Per-finding specs (pain, verified proposal, evidence, verifier notes) were captured at
audit time; the proposals below are the verified/corrected versions.

## Wave 1 — Entity framework (mechanisms reused by all domain fixes)

| # | Finding | Fix |
|---|---------|-----|
| 1 | `action.confirm: true` silently ignored — destructive transitions fire on one tap | Shared AlertDialog honored at all four action surfaces (detail runAction, row menu, mobile cards, raw Move-to items) |
| C1 | Generic "Move to Archived/Cancelled" + bulk bar bypass `archive_batch`/`cancel_batch` RPCs (no loss capture, no vessel release) | `requiresAction` flag on state-machine transition targets routes generic menu/bulk items through the named action's dialog; applied to batches archived/cancelled |
| 2 | Relation-tab "Add" links 404 on non-conventional routes and drop the parent FK | Explicit `basePath` on EntityConfig + single shared route resolver; Add links carry FK; create pages merge `?searchParams` into defaultValues (restricted to known field keys); `hideAdd` where no create route exists; route-resolution test |
| 9 | Relation-tab rows are dead ends | Row-click navigation when the target entity has a resolvable detail route |
| 32 | Transitions never capture their data (Schedule asks no date, Assign no assignee, Fulfill never sets fulfilled_date → corrupts QBO invoice dates) | `transitionFields` pre-transition dialog on EntityActionDef; orders.schedule collects scheduled_date, pick_lists.assign collects assigned_to; migration `00180` BEFORE UPDATE trigger sets fulfilled_date |
| 11 | Status field form-editable on some entities, bypassing transition guards | stateField locked when editing; stripped from update payloads; registry test |
| 6 | Field-level `showWhen` typed and used by configs but never evaluated | Evaluated in FieldGrid (live form values in edit/create, record in view); hidden-at-save values nulled |
| 33 | Create-mode order/PO pages render dead sections and inert Items tabs | `hideOnCreate` sections; relation tabs hidden in create mode; `?tab=` deep-linking; post-create redirect lands on line-item entry |
| C4 | Friendly Postgres-error layer fully built with zero callers — raw DB errors toast everywhere | `parsePostgresError` wired into save/transition/delete paths; unique violations map to `form.setError` on the offending field; CONSTRAINT_MESSAGES populated |
| 10 | No duplicate/clone anywhere but recipes | Generic `duplicate` action (per-entity `excludeOnDuplicate`) via prefill store; enabled on scalar entities (order/recipe specializations in Wave 2) |
| 8 | Bulk ops status-only, desktop-only, selection dies on page flip | Id-keyed selection surviving pagination; bulk delete with per-row failure reporting; selection for any bulk-capable entity |
| 7 | Number/unit inputs fight the keyboard (minus → NaN, mid-keystroke reformat) | Raw-string local state, commit-on-parse, resync only when unfocused or unit changes |
| 4 | Inline quick-create wired to exactly one field pair (water profiles) | Generic QuickCreateDialog auto-attached to relation fields targeting master-data entities (allowlist) |
| C5 | DatePicker click-only — far-future dates take a dozen clicks | Typed entry (date-fns parsing), month/year dropdowns, Today/Clear buttons |

## Wave 2 — Production & packaging

| # | Finding | Fix |
|---|---------|-----|
| 17 | Default brew number collides on double-brew days (DB UNIQUE) | Migration `00181`: server-side `generate_brew_number()` trigger with dedup suffix |
| 18 | Two clicks to start a brew (draft then Start Brew) | Start Brew Day inserts the log already `in_progress` |
| 19 | Planned recipe additions display-only — logging re-enters everything | Per-card "Log" button prefills BatchAdditionForm from the recipe; `isAdditionLogged` catalog-id match fixed |
| 20 | Readings: one metric per submit, form closes/resets | Save-and-add-another, form stays open; FG/ABV suggestion at packaging completion |
| C3 | Readings append-only — typos permanent | Per-row edit/delete (brew-event-timeline pattern); ordering by reading timestamp |
| 21 | Batch creation derives nothing from recipe; no "Plan batch" on recipes | `onFieldChange` recipe prefill on batches/new; Plan Batch from recipe editor + list action via prefill store |
| 12 | Pitch-rate auto-calc dead (target_og never fetched) | Recipe query extended (`target_og`, `recipe_yeasts`); props passed to PitchYeastDialog; phantom type field removed |
| 13 | Start Packaging silently no-ops without recipe/brand | In-dialog brand combobox fallback; `disabledWhen` reason on the action; list-page no-op fixed |
| 15 | Planned packaging quantity typed though derivable | Prefilled `floor(batch volume / unit fill volume)` suggestion; session selector (new vs existing) |
| 16 | Packaging line items force brand-first entry | Batch-first selector auto-setting brand; quick-add row carries batch/brand across lines |
| 14 | Completing a session strands batches in 'packaging' | Post-completion per-batch toast offering guarded Complete transition with side effects |
| C2 | Completed sessions uncorrectable — 'Revised' is a bare label | Revise Quantities dialog as the only path to `revised` (requiresAction); migration `00184` transactional `revise_packaging_session` RPC (line deltas, FG adjustments, depletion delta) |

## Wave 2 — Inventory & purchasing

| # | Finding | Fix |
|---|---------|-----|
| 3 | PO line-item entry and receiving fully built but orphaned (zero importers) | POLineItemsEditor wired as line_items relation component; "Receive Items" action with correct fromStates |
| 39 | Dead-weight: po_receive config unreachable; customer.address & keg packaging_session_id write-only | po_receive resolved with receiving wiring; customer.address surfaced QBO-compatibly (sales wave); keg fill↔session link added (keg task) |
| 24 | Receiving re-asks catalog→item mapping every receipt; free-text locations while bins sit unused | Mapping prefilled from most recent lot via existing FK chain; searchable combobox; bin combobox writing `bin_inventory_items` |
| 26 | Units free-text on PO lines vs closed 6-option select on lots, no guard | One shared unit list across PO line/lot/item; unit-mismatch warning in accept dialog |
| 28 | Material Planning says "Order Now" but offers no action | Row selection + "Create POs for selected" grouped by supplier via existing `createDraftPO`; `inventory_item` added to catalog types |
| 22 | Location transfers dead-end — no UI to add lines | TransferLinesEditor relation component (bin-scoped FG/lot combobox, XOR constraint enforced, planned-only editing) |
| 23 | Primary keg-transaction path guarantees a DB error; every keg movement re-entered | from/to state derived from transaction_type at schema level; migration `00183` reconciles DB automation (order-ship + packaging keg fills) |
| 25 | supplier_catalog has zero UI — assignments re-entered every visit | Assignment upserts `supplier_catalog` (is_preferred, demotion of others); Catalog Items management tab on supplier detail |
| 27 | Counts/adjustments unusable (raw-UUID form, no count workflow, no on-hand column) | Guided Count/Adjust dialog; on-hand on items list; allocation form rehabilitated via showWhen |

## Wave 2 — Sales

| # | Finding | Fix |
|---|---------|-----|
| 29 | `generate_pick_list` RPC matches dropped columns — cannot match UI-entered items | Migration `00182` recreates it on brand_id + selling_format_id, keeping FIFO/guards |
| 30 | Allocation dialog ignores order needs — no auto-FIFO, unfiltered lots | Lot list filtered to order line combos; remaining-to-allocate shown; Auto-allocate (FIFO) prefill |
| 31 | Order and pick-list statuses entered twice | Guarded transition side effects: pick_lists in_progress→orders picking, completed→packed; complete affordance when last item picked |
| 35 | Order items editor writes to DB per keystroke | Blur/Enter commit with local pending state (pick-list pattern) |
| 34 | Orders list/kanban never show the customer | Relation column + migration `00185` `order_list_details` view (search + kanban fields) |
| 10b | No reorder for repeat customers | Duplicate Order / Reorder-last copying lines with re-resolved prices; on order detail + customer Orders tab |
| 39b | customer.address invisible — QBO syncs without billing addresses | Address surfaced with mapAddress()-compatible keys |

## Wave 2/3 — Cross-cutting

| # | Finding | Fix |
|---|---------|-----|
| 36 | cmd+K navigation-only; no global record search | Async entity search (batches/orders/customers/POs/recipes/lots) + Create-X commands in the palette |
| 37 | Dashboard signals stop one step short; onboarding covers 3 of ~10 steps | Reorder affordances on low-stock rows; sales-track onboarding group; prerequisite hints on consuming forms |
| 38 | Hands-on screens (picking, receiving, packaging) are desktop tables; no scan entry | Mobile card layouts (useIsMobile/useIsTouch); keyboard-wedge scan field matching lot numbers on pick lists |
| 5 | Forms demand numbers/dates the system knows | Date defaults to today; PO number prefilled from `generate_next_po_number`; order-number generator |

## Migrations added

- `00180_order_fulfilled_date_trigger.sql` — fulfilled_date set atomically on status→fulfilled
- `00181_brew_number_trigger.sql` — server-side brew-number generation with collision dedup
- `00182_fix_generate_pick_list.sql` — pick-list generation matches current order_items columns
- `00183_keg_transaction_automation.sql` — keg automation reconciled to selling_format model
- `00184_revise_packaging_session.sql` — transactional packaging-session revision RPC
- `00185_order_list_details_view.sql` — orders list view with customer fields
- `00186_order_number_generator.sql` — `generate_next_order_number()` for order-number prefill

Apply with `supabase db push --include-all`, then regenerate types (`bun db:generate`).
Deploy-ordering note: `00181` (brew-number trigger + relaxed client validation) must be
applied before this client code ships, mirroring the `00155` batch_code rollout.
