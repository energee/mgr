/**
 * Seed Script (Single-Tenant)
 *
 * Run with: npx dotenv-cli -e .env -- npx tsx scripts/seed.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function seed() {
  console.log("Seeding database...\n");

  // Update settings
  console.log("Updating settings...");
  const { error: settingsError } = await supabase
    .from("settings")
    .update({
      brewery_name: "Demo Brewing Co",
      timezone: "America/New_York",
      default_batch_size_gallons: 10.0,
    })
    .eq("id", "00000000-0000-0000-0000-000000000001");
  if (settingsError) console.error("Settings error:", settingsError.message);
  else console.log("✓ Settings updated");

  // Create recipes
  console.log("Creating recipes...");
  const { error: recipesError } = await supabase.from("recipes").upsert([
    {
      id: "00000000-0000-0000-0001-000000000001",
      name: "Hazy Days IPA",
      style: "New England IPA",
      description: "Juicy, hazy IPA with tropical hop character",
      target_og: 1.065,
      target_fg: 1.012,
      target_abv: 7.0,
      target_ibu: 45,
      target_srm: 5,
      batch_size_gallons: 10.0,
      boil_time_minutes: 60,
    },
    {
      id: "00000000-0000-0000-0001-000000000002",
      name: "Midnight Stout",
      style: "American Stout",
      description: "Rich, roasty stout with chocolate notes",
      target_og: 1.072,
      target_fg: 1.018,
      target_abv: 7.2,
      target_ibu: 40,
      target_srm: 35,
      batch_size_gallons: 10.0,
      boil_time_minutes: 60,
    },
    {
      id: "00000000-0000-0000-0001-000000000003",
      name: "Summer Wheat",
      style: "American Wheat",
      description: "Light, refreshing wheat beer",
      target_og: 1.048,
      target_fg: 1.010,
      target_abv: 5.0,
      target_ibu: 18,
      target_srm: 4,
      batch_size_gallons: 10.0,
      boil_time_minutes: 60,
    },
    {
      id: "00000000-0000-0000-0001-000000000004",
      name: "Classic Pilsner",
      style: "German Pilsner",
      description: "Crisp, clean lager with noble hop character",
      target_og: 1.046,
      target_fg: 1.008,
      target_abv: 5.0,
      target_ibu: 35,
      target_srm: 3,
      batch_size_gallons: 10.0,
      boil_time_minutes: 90,
    },
  ]);
  if (recipesError) console.error("Recipes error:", recipesError.message);
  else console.log("✓ Recipes created");

  // Create batches
  // Note: actual_og and brew_date are derived from linked brew_logs
  // volume_bbl stores volume in barrels (10 gal = ~0.32 BBL)
  console.log("Creating batches...");
  const { error: batchesError } = await supabase.from("batches").upsert([
    {
      id: "00000000-0000-0000-0002-000000000001",
      recipe_id: "00000000-0000-0000-0001-000000000001",
      batch_number: "2024-001",
      name: "Hazy Days #1",
      status: "completed",
      volume_bbl: 0.32,
      planned_start_date: "2024-12-01",
      fermenter: "FV-1",
      actual_fg: 1.013,
      actual_abv: 7.0,
      notes: "First batch of our NEIPA. Turned out great!",
    },
    {
      id: "00000000-0000-0000-0002-000000000002",
      recipe_id: "00000000-0000-0000-0001-000000000002",
      batch_number: "2024-002",
      name: "Midnight Stout #1",
      status: "conditioning",
      volume_bbl: 0.32,
      planned_start_date: "2024-12-15",
      fermenter: "FV-2",
      actual_fg: 1.019,
      actual_abv: 7.3,
      notes: "Conditioning for another week.",
    },
    {
      id: "00000000-0000-0000-0002-000000000003",
      recipe_id: "00000000-0000-0000-0001-000000000003",
      batch_number: "2025-001",
      name: "Summer Wheat #1",
      status: "fermenting",
      volume_bbl: 0.32,
      planned_start_date: "2025-01-02",
      fermenter: "FV-1",
      notes: "Fermentation looking healthy.",
    },
    {
      id: "00000000-0000-0000-0002-000000000004",
      recipe_id: "00000000-0000-0000-0001-000000000001",
      batch_number: "2025-002",
      name: "Hazy Days #2",
      status: "fermenting",
      volume_bbl: 0.32,
      planned_start_date: "2025-01-09",
      fermenter: "FV-3",
      notes: "Fermentation in progress.",
    },
    {
      id: "00000000-0000-0000-0002-000000000005",
      recipe_id: "00000000-0000-0000-0001-000000000004",
      batch_number: "2025-003",
      name: "Classic Pilsner #1",
      status: "planned",
      volume_bbl: 0.32,
      planned_start_date: "2025-01-15",
      notes: "Scheduled for next week.",
    },
  ]);
  if (batchesError) console.error("Batches error:", batchesError.message);
  else console.log("✓ Batches created");

  // Create package types
  console.log("Creating package types...");
  const { error: pkgTypesError } = await supabase.from("package_types").upsert([
    {
      id: "00000000-0000-0000-0003-000000000001",
      name: "16oz Can",
      container_type: "can",
      volume_oz: 16.0,
      units_per_case: 24,
    },
    {
      id: "00000000-0000-0000-0003-000000000002",
      name: "12oz Can",
      container_type: "can",
      volume_oz: 12.0,
      units_per_case: 24,
    },
    {
      id: "00000000-0000-0000-0003-000000000003",
      name: "Half Barrel Keg",
      container_type: "keg",
      volume_oz: 1984.0,
      units_per_case: 1,
    },
    {
      id: "00000000-0000-0000-0003-000000000004",
      name: "Sixth Barrel Keg",
      container_type: "keg",
      volume_oz: 661.0,
      units_per_case: 1,
    },
  ]);
  if (pkgTypesError) console.error("Package types error:", pkgTypesError.message);
  else console.log("✓ Package types created");

  // Create customers
  console.log("Creating customers...");
  const { error: customersError } = await supabase.from("customers").upsert([
    {
      id: "00000000-0000-0000-0005-000000000001",
      name: "Downtown Distributors",
      customer_type: "distributor",
      contact_name: "John Smith",
      email: "john@downtown.dist",
      phone: "555-0100",
    },
    {
      id: "00000000-0000-0000-0005-000000000002",
      name: "The Hoppy Place",
      customer_type: "retail",
      contact_name: "Jane Doe",
      email: "jane@hoppyplace.com",
      phone: "555-0101",
    },
    {
      id: "00000000-0000-0000-0005-000000000003",
      name: "Craft Corner",
      customer_type: "retail",
      contact_name: "Mike Johnson",
      email: "mike@craftcorner.com",
      phone: "555-0102",
    },
  ]);
  if (customersError) console.error("Customers error:", customersError.message);
  else console.log("✓ Customers created");

  // Create inventory items
  console.log("Creating inventory items...");
  const { error: invError } = await supabase.from("inventory_items").upsert([
    {
      id: "00000000-0000-0000-0008-000000000001",
      category: "grain",
      name: "Pale Malt (2-Row)",
      sku: "GRAIN-001",
      unit: "lb",
      reorder_point: 100.0,
      reorder_qty: 500.0,
      supplier: "Midwest Malting",
    },
    {
      id: "00000000-0000-0000-0008-000000000002",
      category: "grain",
      name: "Munich Malt",
      sku: "GRAIN-002",
      unit: "lb",
      reorder_point: 50.0,
      reorder_qty: 200.0,
      supplier: "Midwest Malting",
    },
    {
      id: "00000000-0000-0000-0008-000000000003",
      category: "hops",
      name: "Citra Hops",
      sku: "HOPS-001",
      unit: "oz",
      reorder_point: 32.0,
      reorder_qty: 64.0,
      supplier: "Yakima Valley Hops",
    },
    {
      id: "00000000-0000-0000-0008-000000000004",
      category: "hops",
      name: "Mosaic Hops",
      sku: "HOPS-002",
      unit: "oz",
      reorder_point: 32.0,
      reorder_qty: 64.0,
      supplier: "Yakima Valley Hops",
    },
    {
      id: "00000000-0000-0000-0008-000000000005",
      category: "yeast",
      name: "US-05 Ale Yeast",
      sku: "YEAST-001",
      unit: "each",
      reorder_point: 10.0,
      reorder_qty: 20.0,
      supplier: "Fermentis",
    },
    {
      id: "00000000-0000-0000-0008-000000000006",
      category: "packaging",
      name: "16oz Cans",
      sku: "PKG-001",
      unit: "case",
      reorder_point: 20.0,
      reorder_qty: 100.0,
      supplier: "Ball Corporation",
    },
  ]);
  if (invError) console.error("Inventory error:", invError.message);
  else console.log("✓ Inventory items created");

  console.log("\n✓ Seed complete!");
}

seed().catch(console.error);
