/** Loads the MGR reference rows needed to build a Beer Orders import plan. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "@/lib/supabase/query-helpers";
import { dynamicFrom, type DynamicQueryBuilder } from "@/services/types";
import type { Database } from "@/types/supabase";
import type {
  BeerOrderBrandRow,
  BeerOrderChannelRow,
  BeerOrderCustomerRow,
  BeerOrderFormatRow,
  BeerOrderKegOwnerRow,
  BeerOrderReferenceData,
  ExistingBeerOrderItemRow,
  ExistingBeerOrderRow,
  SavedBeerOrderBrandMapping,
  SavedBeerOrderCustomerMapping,
} from "./types";

const PAGE_SIZE = 1000;

async function fetchAll<T>(query: () => DynamicQueryBuilder): Promise<T[]> {
  const rows: T[] = [];
  while (true) {
    const page = await unwrap<T[]>(query().range(rows.length, rows.length + PAGE_SIZE - 1));
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function fetchExistingItems(
  admin: SupabaseClient<Database>,
  orders: ExistingBeerOrderRow[],
): Promise<ExistingBeerOrderItemRow[]> {
  const items: ExistingBeerOrderItemRow[] = [];
  for (let index = 0; index < orders.length; index += 50) {
    const ids = orders.slice(index, index + 50).map((order) => order.id);
    if (ids.length === 0) continue;
    items.push(...await fetchAll<ExistingBeerOrderItemRow>(() =>
      dynamicFrom(admin, "order_items")
        .select("id,order_id,brand_id,selling_format_id,quantity,unit_price,keg_owner_id,notes")
        .in("order_id", ids),
    ));
  }
  return items;
}

export async function loadBeerOrderReferenceData(
  admin: SupabaseClient<Database>,
): Promise<BeerOrderReferenceData> {
  const [brands, customers, formats, channels, kegOwners, existingOrders, customerMappings, brandMappings] =
    await Promise.all([
      fetchAll<BeerOrderBrandRow>(() =>
        dynamicFrom(admin, "brands").select("id,name,variant").order("name"),
      ),
      fetchAll<BeerOrderCustomerRow>(() =>
        dynamicFrom(admin, "customers")
          .select("id,name,customer_type,sales_channel_id,price_tier_id")
          .order("name"),
      ),
      fetchAll<BeerOrderFormatRow>(() =>
        dynamicFrom(admin, "selling_formats")
          .select("id,name,unit_count,container:containers(name,type)"),
      ),
      fetchAll<BeerOrderChannelRow>(() =>
        dynamicFrom(admin, "sales_channels").select("id,name").order("name"),
      ),
      fetchAll<BeerOrderKegOwnerRow>(() =>
        dynamicFrom(admin, "keg_owners").select("id,name,is_active").order("name"),
      ),
      fetchAll<ExistingBeerOrderRow>(() =>
        dynamicFrom(admin, "orders")
          .select("id,order_number,customer_id,status,order_date,requested_date,scheduled_date,notes,is_export")
          .like("order_number", "XLSX-%")
          .order("order_date"),
      ),
      fetchAll<SavedBeerOrderCustomerMapping>(() =>
        dynamicFrom(admin, "beer_order_customer_mappings")
          .select("source_key,source_label,customer_id"),
      ),
      fetchAll<SavedBeerOrderBrandMapping>(() =>
        dynamicFrom(admin, "beer_order_brand_mappings")
          .select("source_key,source_label,brand_id,distributor_tier"),
      ),
    ]);
  const existingItems = await fetchExistingItems(admin, existingOrders);
  return {
    brands,
    customers,
    formats,
    channels,
    kegOwners,
    existingOrders,
    existingItems,
    customerMappings,
    brandMappings,
  };
}
