# Migration Plan

## Data Migration from Payload

### Phase 1: Schema Mapping
Map existing Payload collections to new Supabase tables:
- Identify field mappings
- Handle relationship transformations
- Plan for data cleanup

### Phase 2: Migration Scripts
Create idempotent migration scripts:
```typescript
// Example migration script structure
async function migrateRecipes(payload: PayloadData, supabase: SupabaseClient) {
  for (const recipe of payload.recipes) {
    // Transform data
    const transformed = transformRecipe(recipe);

    // Upsert to Supabase
    const { error } = await supabase
      .from('recipes')
      .upsert(transformed, { onConflict: 'legacy_id' });

    if (error) {
      console.error(`Failed to migrate recipe ${recipe.id}:`, error);
    }
  }
}
```

### Phase 3: Validation
- Compare counts between systems
- Spot-check critical data
- Verify relationships intact

### Phase 4: Cutover
- Final sync
- Switch application to new backend
- Monitor for issues

## Migration Order

1. System settings
2. Reference data (styles, formats, keg_types, sales_channels)
3. Users
4. Suppliers and ingredients
5. Yeast strains
6. Recipes
7. Customers
8. Vessels
9. Batches and brew logs
10. Inventory lots
11. Finished goods
12. Allocations
13. Orders
14. Transactions and history

---

## Related Documents

- [Architecture](./architecture.md) - Tech stack
- [Data Model](../data-model/) - Target schema
