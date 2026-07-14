# MGR Migration Scripts

Scripts for migrating legacy catalog/production data and reconciling sales
orders into MGR (Supabase / PostgreSQL).

> Orders are owned by `Beer orders.xlsx`. The normal reconciliation path is
> **Settings → Integrations → Beer Orders Spreadsheet**: upload the workbook,
> review the dry-run, resolve mappings, and explicitly apply. Do not import or
> clean orders from MongoDB; the legacy Mongo order documents do not contain
> MGR's customer, selling-format, pricing, or keg-owner relationships.

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

# 3. Emergency CLI only: preview the spreadsheet order reconciliation
python3 scripts/migration/reconcile_beer_orders.py \
    "/path/to/Beer orders.xlsx"

# 4. Apply only after the dry run has no unresolved mappings
python3 scripts/migration/reconcile_beer_orders.py \
    "/path/to/Beer orders.xlsx" --apply
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

### reconcile_beer_orders.py (emergency CLI)

Reconciles: customers, orders, order items, selling formats, Distributor
prices, and keg owners from `Beer orders.xlsx`.

```bash
python3 scripts/migration/reconcile_beer_orders.py \
    ~/Downloads/Beer\ orders.xlsx

python3 scripts/migration/reconcile_beer_orders.py \
    ~/Downloads/Beer\ orders.xlsx --apply
```

Use the Settings integration for routine reimports. This command remains for
recovery or one-off administrator work when the application is unavailable.
It is dry-run by default; apply mode writes a JSON preimage backup to
`/tmp/mgr-beer-orders-backups` before mutating live data. Distribution keg
lines use Microstar. Internal/taproom blocks are excluded because taproom stock
is allocated to an internal bin rather than represented as customer orders.
Customer and beer aliases are explicit so unresolved workbook names fail closed.

The Settings integration has the same source rules plus saved mappings, an
audited import history, and a single database transaction. It creates new
orders in `draft`, preserves existing order statuses, updates deterministic line
IDs in place, and reports spreadsheet orders missing from a later upload without
changing or deleting them.

### migrate_orders.py (legacy — do not run)

This historical Mongo/BSON converter is retained only for reference. Its SQL
output is not an authoritative MGR order source and must not be applied.

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
```

## Verification

```sql
-- Check record counts
SELECT 'suppliers' as entity, count(*) FROM suppliers
UNION ALL SELECT 'malts', count(*) FROM malts
UNION ALL SELECT 'hops', count(*) FROM hops
UNION ALL SELECT 'yeasts', count(*) FROM yeasts;

-- Check referential integrity
SELECT id, order_number FROM orders
WHERE customer_id IS NOT NULL
AND customer_id NOT IN (SELECT id FROM customers);
```

## UUID Determinism

UUIDs are generated deterministically using Python's `uuid.uuid5()` (RFC 4122 compliant, SHA-1 based) with a fixed migration namespace:

```python
import uuid

MIGRATION_NAMESPACE = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")

def object_id_to_uuid(object_id_str: str) -> str:
    return str(uuid.uuid5(MIGRATION_NAMESPACE, object_id_str))
```

**Benefits:**
- Same MongoDB ObjectID → same UUID every time
- Re-running migrations is idempotent
- Cross-references are consistent
- RFC 4122 compliant UUID v5 format

## Future Migrations

To migrate catalog or production data from a new lolev-manager backup:

1. Export new MongoDB backup
2. Run migration scripts with new `--backup-dir`
3. Execute generated catalog/production SQL files; never execute order output
4. ON CONFLICT will update existing records, insert new ones

The deterministic UUID generation ensures consistency across migrations.

## Full Documentation

For detailed field mappings and troubleshooting, see the full documentation in each script's docstring.
