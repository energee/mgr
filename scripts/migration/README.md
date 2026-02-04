# Lolev-Manager to MGR Migration Scripts

Scripts for migrating data from lolev-manager (Payload CMS / MongoDB) to MGR (Supabase / PostgreSQL).

## Overview

These Python scripts transform MongoDB BSON backups into PostgreSQL-compatible SQL INSERT statements with:
- **Deterministic UUID generation** from MongoDB ObjectIDs (same ID → same UUID)
- **Idempotent upserts** using ON CONFLICT DO UPDATE
- **Field transformations** (unit conversions, status mappings, etc.)
- **Relationship resolution** (foreign keys mapped via deterministic UUIDs)

## Prerequisites

```bash
pip install -r scripts/migration/requirements.txt
```

## Quick Start

```bash
# 1. Export MongoDB backup from lolev-manager
mongodump --uri="mongodb://localhost:27017/lolev-manager" \
          --out=./backup-$(date +%Y-%m-%d) \
          --gzip

# 2. Migrate catalog items
python3 scripts/migration/migrate_catalog_items.py \
    --backup-dir ./backup-2026-01-08/lolev-manager \
    --output-dir ./sql-output

# 3. Migrate orders
python3 scripts/migration/migrate_orders.py \
    --backup-dir ./backup-2026-01-08/lolev-manager \
    --output-dir ./sql-output

# 4. Execute SQL via Supabase dashboard or CLI
# See "Executing the Migration" section below
```

## Migration Scripts

### migrate_catalog_items.py

Migrates: suppliers, malts, hops, yeasts

```bash
python3 scripts/migration/migrate_catalog_items.py \
    --backup-dir ~/db-backups/backup-2026-01-08/lolev-manager \
    --output-dir ./sql-output
```

**Key Transformations:**
- Malts: `yieldOnGrind` (%) → `potential_ppg` (PPG = yield × 0.46)
- Malts: `price` (per bag) → `cost_per_lb` (price / bag_weight)
- Hops: `alphaAcid` → `alpha_acid_min/max` (±10% range)
- Yeasts: Supplier stored as `manufacturer` (inline name)

### migrate_orders.py

Migrates: orders, order_items

```bash
python3 scripts/migration/migrate_orders.py \
    --backup-dir ~/db-backups/backup-2026-01-08/lolev-manager \
    --output-dir ./sql-output \
    --chunk-size 50
```

**Key Transformations:**
- Status mapping: `completed` → `fulfilled`, `scheduled` → `scheduled`
- Order numbers: Generated as `ORD-YYYYMMDD-###`
- Products array → `order_items` table

## Executing the Migration

### Option 1: Supabase Dashboard (Recommended)

1. Navigate to: https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new
2. Copy/paste each SQL file and click "Run"
3. Execute in order:
   - suppliers.sql
   - malts.sql
   - hops.sql
   - yeasts.sql
   - orders.sql
   - order_items_chunk_*.sql (all chunks)

### Option 2: Supabase CLI

```bash
supabase db execute --file sql-output/suppliers.sql
supabase db execute --file sql-output/malts.sql
supabase db execute --file sql-output/hops.sql
supabase db execute --file sql-output/yeasts.sql
supabase db execute --file sql-output/orders.sql

# Execute all order_items chunks
for file in sql-output/order_items_chunk_*.sql; do
    supabase db execute --file "$file"
done
```

## Verification

```sql
-- Check record counts
SELECT 'suppliers' as entity, count(*) FROM suppliers
UNION ALL SELECT 'malts', count(*) FROM malts
UNION ALL SELECT 'hops', count(*) FROM hops
UNION ALL SELECT 'yeasts', count(*) FROM yeasts
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'order_items', count(*) FROM order_items;

-- Check referential integrity
SELECT id, order_number FROM orders
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);
```

## UUID Determinism

UUIDs are generated deterministically using SHA256:

```python
def object_id_to_uuid(object_id_str):
    hash_obj = sha256(f"mgr-migration-{object_id_str}".encode())
    hash_hex = hash_obj.hexdigest()
    return f"{hash_hex[0:8]}-{hash_hex[8:12]}-4{hash_hex[13:16]}-8{hash_hex[17:20]}-{hash_hex[20:32]}"
```

**Benefits:**
- Same MongoDB ObjectID → same UUID every time
- Re-running migrations is idempotent
- Cross-references are consistent

## Future Migrations

To migrate from a new lolev-manager backup:

1. Export new MongoDB backup
2. Run migration scripts with new `--backup-dir`
3. Execute generated SQL files
4. ON CONFLICT will update existing records, insert new ones

The deterministic UUID generation ensures consistency across migrations.

## Full Documentation

For detailed field mappings and troubleshooting, see the full documentation in each script's docstring.
