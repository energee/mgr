# MGR Migration Scripts

Scripts for migrating legacy catalog/production data and reconciling sales
orders into MGR (Supabase / PostgreSQL).

> Orders are owned by `Beer orders.xlsx`. Do not import or clean orders from
> MongoDB; the legacy Mongo order documents do not contain MGR's customer,
> selling-format, pricing, or keg-owner relationships.

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

# 3. Preview the spreadsheet order reconciliation
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

### reconcile_beer_orders.py

Reconciles: customers, orders, order items, selling formats, Distributor
prices, and keg owners from `Beer orders.xlsx`.

```bash
python3 scripts/migration/reconcile_beer_orders.py \
    ~/Downloads/Beer\ orders.xlsx

python3 scripts/migration/reconcile_beer_orders.py \
    ~/Downloads/Beer\ orders.xlsx --apply
```

The command is dry-run by default. Apply mode writes a JSON preimage backup to
`/tmp/mgr-beer-orders-backups` before mutating live data. Distribution keg
lines use Microstar; the internal/taproom rule is KegFleet. Customer and beer
aliases are explicit in the script so unresolved workbook names fail closed.

### cancel_historical_beer_orders.py

Cancels: the ~200 historical pre-cutover `Beer orders.xlsx` keg orders that the
reconciliation left `packed` (their packaging fills/lots were never recorded in
MGR, so fulfilling them would fabricate keg inventory transactions).

Per the decision on [issue #425](https://github.com/energee/mgr/issues/425),
those orders are retained as reference records and transitioned
`packed` → `cancelled` — a terminal state excluded from open-demand and
material-planning queries — while every order/item row, source note, date,
customer, price, and keg-owner assignment is preserved untouched. A dedicated
historical-fulfillment bypass was explicitly rejected for this cleanup.

```bash
# Preview only (default): counts, histograms, full id/order_number list
python3 scripts/migration/cancel_historical_beer_orders.py

# Apply after reviewing the preview (expected ~200 candidates)
python3 scripts/migration/cancel_historical_beer_orders.py --apply
```

The command is dry-run by default and identifies candidates by deterministic
XLSX ownership metadata (`XLSX-*` order number, importer notes prefix) plus a
pre-cutover `order_date` (`--cutover`, default 2026-07-14). Apply mode writes a
JSON preimage backup to `/tmp/mgr-beer-orders-backups`, transitions only
`packed` candidates, releases their still-planned finished-goods allocations,
removes the per-user "Order Cancelled" broadcast notifications the run
generates, and verifies the result (all candidates cancelled, item rows
unchanged). Completed allocations and pick lists are left untouched. Execution
against hosted data is a human action.

If an apply run dies partway, re-running `--apply` completes the still-packed
remainder; the two cosmetic cleanup steps (allocation release, notification
removal) are not repeated for the already-cancelled subset — the preimage
backup lists every candidate id for finishing those manually if needed.

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
