#!/usr/bin/env python3
"""
Migrate catalog items from lolev-manager (MongoDB) to MGR (PostgreSQL)

Migrates: suppliers, malts, hops, yeasts

Usage:
    python3 migrate_catalog_items.py --backup-dir /path/to/backup --output-dir /path/to/output

Example:
    python3 migrate_catalog_items.py \
        --backup-dir ~/db-backups/backup-2026-01-08/lolev-manager \
        --output-dir ./sql-output
"""
import argparse
from pathlib import Path

from migration_utils import escape_sql_string, load_collection, object_id_to_uuid


def main():
    parser = argparse.ArgumentParser(description='Migrate catalog items from MongoDB to PostgreSQL')
    parser.add_argument('--backup-dir', required=True, help='Path to MongoDB backup directory')
    parser.add_argument('--output-dir', default='./sql-output', help='Output directory for SQL files')
    args = parser.parse_args()

    backup_dir = Path(args.backup_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load all collections
    print("Loading collections...")
    suppliers = load_collection(backup_dir, 'suppliers')
    malts = load_collection(backup_dir, 'malts')
    hops = load_collection(backup_dir, 'hops')
    yeasts = load_collection(backup_dir, 'yeasts')

    print(f"Loaded: {len(suppliers)} suppliers, {len(malts)} malts, {len(hops)} hops, {len(yeasts)} yeasts")

    # Create ID mappings
    id_map = {}
    for supplier in suppliers:
        id_map[str(supplier['_id'])] = {
            'uuid': object_id_to_uuid(str(supplier['_id'])),
            'name': supplier['name']
        }

    # Migrate suppliers
    print("\n=== SUPPLIERS ===")
    supplier_sql = []
    for supplier in suppliers:
        uuid = object_id_to_uuid(str(supplier['_id']))
        name = escape_sql_string(supplier['name'])

        supplier_sql.append(
            f"  ('{uuid}', '{name}', true)"
        )

    suppliers_insert = "INSERT INTO suppliers (id, name, is_active) VALUES\n" + ",\n".join(supplier_sql) + "\nON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active;"

    with open(output_dir / 'suppliers.sql', 'w') as f:
        f.write(suppliers_insert)
    print(f"✅ Suppliers: {len(supplier_sql)} records → {output_dir}/suppliers.sql")

    # Migrate malts
    print("\n=== MALTS ===")
    malt_sql = []
    for malt in malts:
        uuid = object_id_to_uuid(str(malt['_id']))
        name = escape_sql_string(malt['name'])

        # Get supplier name if available
        supplier_id = str(malt.get('supplier', ''))
        maltster = escape_sql_string(id_map.get(supplier_id, {}).get('name')) if supplier_id in id_map else None

        color = malt.get('color') or malt.get('srm')
        diastatic_power = malt.get('diastaticPower')
        moisture = malt.get('moisture')
        protein = malt.get('protein')

        # Convert yield percentage to PPG (potential points per gallon)
        # 0.46 is the standard conversion factor: PPG = yield% * 46 / 100
        # e.g. 80% yield → 36.8 PPG (sucrose is 46 PPG at 100% yield)
        extract_pct = malt.get('yieldOnGrind')
        potential_ppg = round(extract_pct * 0.46, 1) if extract_pct else None

        bag_weight = malt.get('weight', 55)
        price_per_bag = malt.get('price', 0)
        cost_per_lb = round(price_per_bag / bag_weight, 2) if price_per_bag and bag_weight > 0 else None

        malt_sql.append(
            f"  ('{uuid}', '{name}', " +
            (f"'{maltster}'" if maltster else "NULL") + ", " +
            (f"{color}" if color else "NULL") + ", " +
            (f"{diastatic_power}" if diastatic_power else "NULL") + ", " +
            (f"{moisture}" if moisture else "NULL") + ", " +
            (f"{protein}" if protein else "NULL") + ", " +
            (f"{potential_ppg}" if potential_ppg else "NULL") + ", " +
            (f"{bag_weight}" if bag_weight else "NULL") + ", " +
            (f"{cost_per_lb}" if cost_per_lb else "NULL") + ", " +
            "true)"
        )

    malts_insert = "INSERT INTO malts (id, name, maltster, color_lovibond, diastatic_power, moisture_percent, protein_percent, potential_ppg, bag_weight_lbs, cost_per_lb, is_active) VALUES\n" + ",\n".join(malt_sql) + "\nON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, maltster = EXCLUDED.maltster, color_lovibond = EXCLUDED.color_lovibond, diastatic_power = EXCLUDED.diastatic_power, moisture_percent = EXCLUDED.moisture_percent, protein_percent = EXCLUDED.protein_percent, potential_ppg = EXCLUDED.potential_ppg, bag_weight_lbs = EXCLUDED.bag_weight_lbs, cost_per_lb = EXCLUDED.cost_per_lb, is_active = EXCLUDED.is_active;"

    with open(output_dir / 'malts.sql', 'w') as f:
        f.write(malts_insert)
    print(f"✅ Malts: {len(malt_sql)} records → {output_dir}/malts.sql")

    # Migrate hops
    print("\n=== HOPS ===")
    hop_sql = []
    for hop in hops:
        uuid = object_id_to_uuid(str(hop['_id']))
        name = escape_sql_string(hop['name'])

        alpha_acid = hop.get('alphaAcid')
        beta_acid = hop.get('betaAcid')
        total_oil = hop.get('totalOil')

        # Alpha acid ranges: estimate ±10% from the typical value,
        # since the source data only has a single alpha acid measurement
        alpha_min = round(alpha_acid * 0.9, 1) if alpha_acid else None
        alpha_max = round(alpha_acid * 1.1, 1) if alpha_acid else None

        # Beta acid ranges
        beta_min = beta_acid
        beta_max = beta_acid

        bag_weight = hop.get('weight', 11)
        cost_per_lb = hop.get('pricePerPound')

        hop_sql.append(
            f"  ('{uuid}', '{name}', " +
            (f"{alpha_acid}" if alpha_acid else "NULL") + ", " +
            (f"{alpha_min}" if alpha_min else "NULL") + ", " +
            (f"{alpha_max}" if alpha_max else "NULL") + ", " +
            (f"{beta_min}" if beta_min else "NULL") + ", " +
            (f"{beta_max}" if beta_max else "NULL") + ", " +
            (f"{total_oil}" if total_oil else "NULL") + ", " +
            (f"{bag_weight}" if bag_weight else "NULL") + ", " +
            (f"{cost_per_lb}" if cost_per_lb else "NULL") + ", " +
            "true)"
        )

    hops_insert = "INSERT INTO hops (id, name, alpha_acid_typical, alpha_acid_min, alpha_acid_max, beta_acid_min, beta_acid_max, oil_ml_100g, bag_weight_lbs, cost_per_lb, is_active) VALUES\n" + ",\n".join(hop_sql) + "\nON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, alpha_acid_typical = EXCLUDED.alpha_acid_typical, alpha_acid_min = EXCLUDED.alpha_acid_min, alpha_acid_max = EXCLUDED.alpha_acid_max, beta_acid_min = EXCLUDED.beta_acid_min, beta_acid_max = EXCLUDED.beta_acid_max, oil_ml_100g = EXCLUDED.oil_ml_100g, bag_weight_lbs = EXCLUDED.bag_weight_lbs, cost_per_lb = EXCLUDED.cost_per_lb, is_active = EXCLUDED.is_active;"

    with open(output_dir / 'hops.sql', 'w') as f:
        f.write(hops_insert)
    print(f"✅ Hops: {len(hop_sql)} records → {output_dir}/hops.sql")

    # Migrate yeasts
    print("\n=== YEASTS ===")
    yeast_sql = []
    for yeast in yeasts:
        uuid = object_id_to_uuid(str(yeast['_id']))
        name = escape_sql_string(yeast['name'])

        # Get supplier name (stored as manufacturer in MGR)
        supplier_id = str(yeast.get('supplier', ''))
        manufacturer = escape_sql_string(id_map.get(supplier_id, {}).get('name')) if supplier_id in id_map else None

        temp_range = yeast.get('temperatureRange', {})
        temp_min = temp_range.get('low')
        temp_max = temp_range.get('high')

        atten_range = yeast.get('attenuation', {})
        atten_min = atten_range.get('low')
        atten_max = atten_range.get('high')

        flocculation = escape_sql_string(yeast.get('flocculation'))
        alcohol_tolerance = yeast.get('alcoholTolerance')

        yeast_sql.append(
            f"  ('{uuid}', '{name}', " +
            (f"'{manufacturer}'" if manufacturer else "NULL") + ", " +
            (f"{temp_min}" if temp_min else "NULL") + ", " +
            (f"{temp_max}" if temp_max else "NULL") + ", " +
            (f"{atten_min}" if atten_min else "NULL") + ", " +
            (f"{atten_max}" if atten_max else "NULL") + ", " +
            (f"'{flocculation}'" if flocculation else "NULL") + ", " +
            (f"{alcohol_tolerance}" if alcohol_tolerance else "NULL") + ", " +
            "true)"
        )

    yeasts_insert = "INSERT INTO yeasts (id, name, manufacturer, temp_min_f, temp_max_f, attenuation_min, attenuation_max, flocculation, alcohol_tolerance, is_active) VALUES\n" + ",\n".join(yeast_sql) + "\nON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, manufacturer = EXCLUDED.manufacturer, temp_min_f = EXCLUDED.temp_min_f, temp_max_f = EXCLUDED.temp_max_f, attenuation_min = EXCLUDED.attenuation_min, attenuation_max = EXCLUDED.attenuation_max, flocculation = EXCLUDED.flocculation, alcohol_tolerance = EXCLUDED.alcohol_tolerance, is_active = EXCLUDED.is_active;"

    with open(output_dir / 'yeasts.sql', 'w') as f:
        f.write(yeasts_insert)
    print(f"✅ Yeasts: {len(yeast_sql)} records → {output_dir}/yeasts.sql")

    print("\n" + "="*60)
    print("✅ Catalog migration complete!")
    print("="*60)
    print(f"\nSQL files created in: {output_dir}")
    print(f"  - suppliers.sql ({len(supplier_sql)} records)")
    print(f"  - malts.sql ({len(malt_sql)} records)")
    print(f"  - hops.sql ({len(hop_sql)} records)")
    print(f"  - yeasts.sql ({len(yeast_sql)} records)")
    print(f"\nTotal: {len(supplier_sql) + len(malt_sql) + len(hop_sql) + len(yeast_sql)} catalog records")


if __name__ == '__main__':
    main()
