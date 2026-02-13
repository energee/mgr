# Universal Entity Delete

## Problem

Delete is only supported on recipes via a bespoke `RecipeDeleteDialog` with page-level wiring. Most entities have no delete/deactivate capability from the UI, despite many having `is_active` columns ready for soft delete.

## Design

### Delete modes

Each entity's `delete` action specifies a mode:

- **`hard`** — `DELETE FROM table WHERE id = ?`. Used for entities with no downstream activity (per DEC-GAP-010). FK constraint errors caught and shown as friendly messages.
- **`soft`** — `UPDATE table SET is_active = false WHERE id = ?`. Used for reference/catalog entities that may be referenced by other records. Dialog says "Deactivate" instead of "Delete".

Mode is specified on the action definition:

```typescript
{
  name: "delete",
  label: "Delete Location",
  icon: "trash",
  type: "dropdown",
  variant: "destructive",
  deleteMode: "soft", // or "hard"
}
```

### Universal EntityDeleteDialog

A single dialog component handles both modes:

- Shows entity display name + record title (from `detailHeader.title` field)
- Soft mode: "Deactivate" button, copy explains record will be hidden but preserved
- Hard mode: "Delete" button with destructive styling, copy warns deletion is permanent
- On confirm: executes the appropriate Supabase call
- FK constraint errors: friendly message ("Can't delete — referenced by other records")
- On success: invalidates queries, navigates back to list (detail view) or refreshes (list view)

### Integration points

**EntityDetailUnified**: When an action with `name: "delete"` is clicked and not handled by `onAction`, opens `EntityDeleteDialog`. Custom `onAction` can still intercept.

**EntityDataTable / buildActionsColumn**: Same — detects delete actions in row menu and opens the dialog.

### Entities getting delete actions (this round)

Reference/catalog entities with `is_active` (soft delete):
- location, customer, supplier, inventory-item, vessel, beer-style, bin, keg-type, keg-owner, package-type, sales-channel, yeast-strain, enum-value, pricing-tier-price

Recipe (hard delete, migrated from bespoke):
- recipe — existing `disabledWhen` check preserved

### Migration from recipe bespoke delete

- Remove `RecipeDeleteDialog` component
- Revert `recipes/page.tsx` to simple `<EntityList>` (remove custom `onAction` + dialog state)
- Recipe's existing `delete` action config already has `disabledWhen` for batch count guard

### Future work (not this round)

- Add `is_active` to brand, pricing-tier, purchase-order, delivery
- DEC-GAP-010 conditional hard-deletes for batch, brew_log, packaging_session, order, yeast_pitch
- Blocking conditions for soft delete (e.g., batch with completed orders)
