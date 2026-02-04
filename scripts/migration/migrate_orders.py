#!/usr/bin/env python3
"""
Migrate orders from lolev-manager (MongoDB) to MGR (PostgreSQL)

Migrates: orders, order_items

Usage:
    python3 migrate_orders.py --backup-dir /path/to/backup --output-dir /path/to/output

Example:
    python3 migrate_orders.py \
        --backup-dir ~/db-backups/backup-2026-01-08/lolev-manager \
        --output-dir ./sql-output
"""
import argparse
import bson
import gzip
from hashlib import sha256
from pathlib import Path


def object_id_to_uuid(object_id_str):
    """Generate deterministic UUID from MongoDB ObjectID"""
    hash_obj = sha256(f"mgr-migration-{object_id_str}".encode())
    hash_hex = hash_obj.hexdigest()
    return f"{hash_hex[0:8]}-{hash_hex[8:12]}-4{hash_hex[13:16]}-8{hash_hex[17:20]}-{hash_hex[20:32]}"


def load_collection(backup_dir, name):
    """Load and decode BSON collection"""
    with gzip.open(f"{backup_dir}/{name}.bson.gz", 'rb') as f:
        data = f.read()
    return bson.decode_all(data)


def escape_sql_string(s):
    """Escape single quotes for SQL"""
    if s is None:
        return None
    return str(s).replace("'", "''").replace("\n", "\\n").replace("\r", "")


def format_date(date_obj):
    """Format date object to SQL date string"""
    if date_obj is None:
        return None
    if hasattr(date_obj, 'strftime'):
        return date_obj.strftime('%Y-%m-%d')
    return None


def map_order_status(lolev_status):
    """Map lolev order status to MGR status"""
    status_map = {
        'scheduled': 'scheduled',
        'completed': 'fulfilled',
        'cancelled': 'cancelled',
        'draft': 'draft',
        'pending': 'draft',
        'in-progress': 'confirmed'
    }
    return status_map.get(lolev_status, 'draft')


def main():
    parser = argparse.ArgumentParser(description='Migrate orders from MongoDB to PostgreSQL')
    parser.add_argument('--backup-dir', required=True, help='Path to MongoDB backup directory')
    parser.add_argument('--output-dir', default='./sql-output', help='Output directory for SQL files')
    parser.add_argument('--chunk-size', type=int, default=50, help='Order items per chunk file')
    args = parser.parse_args()

    backup_dir = Path(args.backup_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load all collections
    print("Loading collections...")
    orders = load_collection(backup_dir, 'orders')
    customers = load_collection(backup_dir, 'customers')
    beers = load_collection(backup_dir, 'beers')
    formats = load_collection(backup_dir, 'formats')

    print(f"Loaded: {len(orders)} orders, {len(customers)} customers, {len(beers)} beers, {len(formats)} formats")

    # Create ID mappings
    customer_map = {str(c['_id']): object_id_to_uuid(str(c['_id'])) for c in customers}
    beer_map = {str(b['_id']): object_id_to_uuid(str(b['_id'])) for b in beers}
    format_map = {str(f['_id']): object_id_to_uuid(str(f['_id'])) for f in formats}

    # Migrate orders
    print("\n=== ORDERS ===")
    order_sql = []
    order_items_sql = []

    for idx, order in enumerate(orders, 1):
        order_id = object_id_to_uuid(str(order['_id']))
        customer_id = customer_map.get(str(order.get('customer', '')))

        # Generate order number (ORD-YYYYMMDD-###)
        order_date = order.get('date') or order.get('createdAt')
        if order_date and hasattr(order_date, 'strftime'):
            date_part = order_date.strftime('%Y%m%d')
        else:
            date_part = '20240101'
        order_number = f"ORD-{date_part}-{idx:03d}"

        status = map_order_status(order.get('status', 'draft'))
        order_date_str = format_date(order.get('date'))
        fulfilled_date_str = format_date(order.get('completedDate'))
        notes = escape_sql_string(order.get('notes'))

        created_at = order.get('createdAt')
        created_at_str = created_at.isoformat() if created_at and hasattr(created_at, 'isoformat') else None
        updated_at = order.get('updatedAt')
        updated_at_str = updated_at.isoformat() if updated_at and hasattr(updated_at, 'isoformat') else None

        order_sql.append(
            f"  ('{order_id}', " +
            (f"'{customer_id}'" if customer_id else "NULL") + ", " +
            f"'{order_number}', " +
            f"'{status}', " +
            (f"'{order_date_str}'" if order_date_str else "CURRENT_DATE") + ", " +
            "NULL, " +  # requested_date
            "NULL, " +  # scheduled_date
            (f"'{fulfilled_date_str}'" if fulfilled_date_str else "NULL") + ", " +
            "NULL, " +  # shipping_address
            (f"'{notes}'" if notes else "NULL") + ", " +
            (f"'{created_at_str}'" if created_at_str else "CURRENT_TIMESTAMP") + ", " +
            (f"'{updated_at_str}'" if updated_at_str else "CURRENT_TIMESTAMP") + ", " +
            "false)"  # is_export
        )

        # Process order items (products array)
        products = order.get('products', [])
        for product in products:
            item_id = object_id_to_uuid(str(product.get('id', order['_id'])))

            # Get brand_id from product reference
            product_ref = product.get('product', {})
            if isinstance(product_ref, dict):
                beer_id = str(product_ref.get('value', ''))
                brand_id = beer_map.get(beer_id)
            else:
                brand_id = None

            # Get package_type_id
            packaging_format = str(product.get('packagingFormat', ''))
            package_type_id = format_map.get(packaging_format)

            quantity = product.get('quantity', 0)

            # Get unit price
            pricing = product.get('pricing', {})
            unit_price = pricing.get('unitPrice', 0) if isinstance(pricing, dict) else 0

            order_items_sql.append(
                f"  ('{item_id}', " +
                f"'{order_id}', " +
                "NULL, " +  # package_id
                "NULL, " +  # batch_id
                (f"'{package_type_id}'" if package_type_id else "NULL") + ", " +
                f"{quantity}, " +
                (f"{unit_price}" if unit_price else "NULL") + ", " +
                "NULL, " +  # notes
                (f"'{created_at_str}'" if created_at_str else "CURRENT_TIMESTAMP") + ", " +
                (f"'{brand_id}'" if brand_id else "NULL") + ", " +
                "NULL, " +  # style_id
                "NULL)"  # tbd_notes
            )

    # Write orders SQL
    orders_insert = "INSERT INTO orders (id, customer_id, order_number, status, order_date, requested_date, scheduled_date, fulfilled_date, shipping_address, notes, created_at, updated_at, is_export) VALUES\n" + ",\n".join(order_sql) + "\nON CONFLICT (id) DO UPDATE SET customer_id = EXCLUDED.customer_id, order_number = EXCLUDED.order_number, status = EXCLUDED.status, order_date = EXCLUDED.order_date, fulfilled_date = EXCLUDED.fulfilled_date, notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at;"

    with open(output_dir / 'orders.sql', 'w') as f:
        f.write(orders_insert)
    print(f"✅ Orders: {len(order_sql)} records → {output_dir}/orders.sql")

    # Write order_items SQL (split into chunks)
    if order_items_sql:
        chunk_size = args.chunk_size
        chunks = [order_items_sql[i:i + chunk_size] for i in range(0, len(order_items_sql), chunk_size)]

        header = "INSERT INTO order_items (id, order_id, package_id, batch_id, package_type_id, quantity, unit_price, notes, created_at, brand_id, style_id, tbd_notes) VALUES\n"
        footer = "\nON CONFLICT (id) DO UPDATE SET order_id = EXCLUDED.order_id, package_type_id = EXCLUDED.package_type_id, quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price, brand_id = EXCLUDED.brand_id;"

        for idx, chunk in enumerate(chunks, 1):
            chunk_copy = chunk.copy()
            if chunk_copy[-1].endswith(','):
                chunk_copy[-1] = chunk_copy[-1][:-1]

            chunk_sql = header + ",\n".join(chunk_copy) + footer

            filename = f'order_items_chunk_{idx}.sql'
            with open(output_dir / filename, 'w') as f:
                f.write(chunk_sql)

            print(f"  Chunk {idx}: {len(chunk)} items → {output_dir}/{filename}")

        print(f"✅ Order Items: {len(order_items_sql)} records → {len(chunks)} chunk files")

    print("\n" + "="*60)
    print("✅ Orders migration complete!")
    print("="*60)
    print(f"\nSQL files created in: {output_dir}")
    print(f"  - orders.sql ({len(order_sql)} records)")
    print(f"  - order_items_chunk_*.sql ({len(order_items_sql)} total items in {len(chunks)} files)")


if __name__ == '__main__':
    main()
