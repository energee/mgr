/**
 * Schema Context Utilities for AI Integration
 *
 * These utilities help AI agents understand the MGR database schema,
 * relationships between tables, and available operations.
 */

import { createClient } from "@/lib/supabase/client";

// Create client once at module level (createClient returns singleton)
const supabase = createClient();

// Types
export interface SchemaTable {
  table_name: string;
  description: string;
  domain: string;
  relationships: {
    hasMany?: Array<{ name: string; table: string }>;
    belongsTo?: Array<{ name: string; table: string }>;
  } | null;
  key_fields: string[] | null;
  state_machine: {
    stateField: string;
    states: string[];
    transitions: Record<string, string[]>;
  } | null;
  query_examples: string[] | null;
  ai_context: {
    purpose?: string;
    ai_actions?: string[];
    ai_usage?: string;
    key_fields_for_ai?: string[];
    key_relationships?: Record<string, string>;
  } | null;
  calculated_fields: Array<{
    field: string;
    source: string;
    formula: string;
  }> | null;
}

export interface SchemaContext {
  tables: SchemaTable[];
}

export interface DomainSummary {
  domain: string;
  tables: string[];
  description: string;
}

/**
 * Domain descriptions for AI context
 */
export const DOMAIN_DESCRIPTIONS: Record<string, string> = {
  system: "Core system configuration, settings, users, and locations",
  catalog:
    "Reference data for ingredients (malts, hops, yeasts), beer styles, and package types",
  production:
    "Recipes, batches, brew logs, vessels, and fermentation tracking",
  inventory:
    "Raw material inventory, finished goods, allocations, bins, and transfers",
  packaging: "Packaging sessions, finished goods creation, and session line items",
  purchasing: "Suppliers, purchase orders, receiving, and inventory lots",
  sales: "Customers, orders, sales channels, pricing tiers, and order fulfillment",
  kegs: "Keg inventory, customer balances, and keg transactions",
  notifications: "System notifications and user preferences",
};

/**
 * Get complete schema context for AI agents
 */
export async function getSchemaContext(
  domain?: string
): Promise<SchemaContext> {

  const { data, error } = await supabase.rpc("get_ai_schema_context", {
    p_domain: domain ?? undefined,
  });

  if (error) {
    throw new Error(`Failed to get schema context: ${error.message}`);
  }

  return data as unknown as SchemaContext;
}

/**
 * Get schema registry entries directly
 */
export async function getSchemaRegistry(
  domain?: string
): Promise<SchemaTable[]> {

  let query = supabase
    .from("_schema_registry")
    .select("*")
    .order("domain")
    .order("table_name");

  if (domain) {
    query = query.eq("domain", domain);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get schema registry: ${error.message}`);
  }

  return data as SchemaTable[];
}

/**
 * Get a summary of all domains
 */
export async function getDomainSummary(): Promise<DomainSummary[]> {

  const { data, error } = await supabase
    .from("_schema_registry")
    .select("domain, table_name")
    .order("domain");

  if (error) {
    throw new Error(`Failed to get domain summary: ${error.message}`);
  }

  // Group by domain
  const domains = new Map<string, string[]>();
  for (const row of data) {
    if (!domains.has(row.domain)) {
      domains.set(row.domain, []);
    }
    domains.get(row.domain)!.push(row.table_name);
  }

  return Array.from(domains.entries()).map(([domain, tables]) => ({
    domain,
    tables,
    description: DOMAIN_DESCRIPTIONS[domain] || `Tables in the ${domain} domain`,
  }));
}

/**
 * Get table information with relationships
 */
export async function getTableInfo(tableName: string): Promise<SchemaTable | null> {

  const { data, error } = await supabase
    .from("_schema_registry")
    .select("*")
    .eq("table_name", tableName)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw new Error(`Failed to get table info: ${error.message}`);
  }

  return data as SchemaTable;
}

/**
 * Find tables related to a given table
 */
export async function getRelatedTables(
  tableName: string
): Promise<{ table: string; relationship: string; direction: string }[]> {

  const { data, error } = await supabase
    .from("_schema_registry")
    .select("table_name, relationships");

  if (error) {
    throw new Error(`Failed to get related tables: ${error.message}`);
  }

  const related: { table: string; relationship: string; direction: string }[] = [];

  // Type for the relationships JSONB column
  type RelationshipDef = { table: string; name: string };
  type RelationshipsJson = {
    hasMany?: RelationshipDef[];
    belongsTo?: RelationshipDef[];
  };

  for (const row of data) {
    if (!row.relationships) continue;

    const relationships = row.relationships as RelationshipsJson;

    // Check hasMany relationships
    if (relationships.hasMany) {
      for (const rel of relationships.hasMany) {
        if (rel.table === tableName) {
          related.push({
            table: row.table_name,
            relationship: rel.name,
            direction: "parent",
          });
        }
        if (row.table_name === tableName) {
          related.push({
            table: rel.table,
            relationship: rel.name,
            direction: "child",
          });
        }
      }
    }

    // Check belongsTo relationships
    if (relationships.belongsTo) {
      for (const rel of relationships.belongsTo) {
        if (rel.table === tableName) {
          related.push({
            table: row.table_name,
            relationship: rel.name,
            direction: "child",
          });
        }
        if (row.table_name === tableName) {
          related.push({
            table: rel.table,
            relationship: rel.name,
            direction: "parent",
          });
        }
      }
    }
  }

  return related;
}

/**
 * Get state machine information for an entity
 */
export async function getStateMachine(
  tableName: string
): Promise<{
  stateField: string;
  states: string[];
  transitions: Record<string, string[]>;
} | null> {
  const tableInfo = await getTableInfo(tableName);
  return tableInfo?.state_machine || null;
}

/**
 * Get valid next states for an entity in a given state
 */
export async function getValidTransitions(
  tableName: string,
  currentState: string
): Promise<string[]> {
  const stateMachine = await getStateMachine(tableName);
  if (!stateMachine) return [];
  return stateMachine.transitions[currentState] || [];
}

/**
 * Generate a context prompt for AI based on the schema
 */
export async function generateAIContextPrompt(
  domains?: string[]
): Promise<string> {
  const allDomains = await getDomainSummary();
  const targetDomains = domains
    ? allDomains.filter((d) => domains.includes(d.domain))
    : allDomains;

  let prompt = `# MGR Brewery Management System Schema\n\n`;

  for (const domain of targetDomains) {
    prompt += `## ${domain.domain.charAt(0).toUpperCase() + domain.domain.slice(1)} Domain\n`;
    prompt += `${domain.description}\n\n`;
    prompt += `**Tables:** ${domain.tables.join(", ")}\n\n`;
  }

  // Add key concepts
  prompt += `## Key Concepts\n\n`;
  prompt += `- **Allocations**: All inventory movements tracked via unified allocations table\n`;
  prompt += `- **Calculated Fields**: OG, FG, ABV, IBU, SRM calculated on read via views\n`;
  prompt += `- **State Machines**: Entities like batches, orders have defined state transitions\n`;
  prompt += `- **No Mutable Balances**: Quantities always calculated from allocations\n`;

  return prompt;
}

/**
 * Query templates for common AI operations
 */
export const QUERY_TEMPLATES = {
  // Recipe queries
  getRecipeWithEstimates: `
    SELECT r.*, re.est_og, re.est_fg, re.est_abv, re.est_ibu, re.est_srm, re.est_cogs
    FROM recipes_with_estimates re
    JOIN recipes r ON r.id = re.id
    WHERE r.id = $1
  `,

  getRecipeIngredients: `
    SELECT
      'malt' as type, rm.weight_lbs as amount, 'lbs' as unit, m.name, rm.position
    FROM recipe_malts rm
    JOIN malts m ON m.id = rm.malt_id
    WHERE rm.recipe_id = $1
    UNION ALL
    SELECT
      'hop' as type, rh.weight_oz as amount, 'oz' as unit, h.name, rh.position
    FROM recipe_hops rh
    JOIN hops h ON h.id = rh.hop_id
    WHERE rh.recipe_id = $1
    ORDER BY type, position
  `,

  // Batch queries
  getBatchesInProgress: `
    SELECT b.*, r.name as recipe_name
    FROM batches b
    JOIN recipes r ON r.id = b.recipe_id
    WHERE b.status NOT IN ('completed', 'cancelled')
    ORDER BY b.planned_start_date
  `,

  getBatchWithBrewData: `
    SELECT
      b.*,
      r.name as recipe_name,
      bl.brew_date,
      bl.events as brew_events
    FROM batches b
    LEFT JOIN recipes r ON r.id = b.recipe_id
    LEFT JOIN brew_log_batches blb ON blb.batch_id = b.id
    LEFT JOIN brew_logs bl ON bl.id = blb.brew_log_id
    WHERE b.id = $1
  `,

  // Inventory queries
  getAvailableInventory: `
    SELECT
      br.name as brand_name,
      pt.name as package_type,
      SUM(bi.quantity) as total_quantity
    FROM bin_inventory bi
    JOIN finished_goods fg ON fg.id = bi.finished_good_id
    JOIN brands br ON br.id = fg.brand_id
    JOIN package_types pt ON pt.id = fg.package_type_id
    GROUP BY br.id, pt.id
    ORDER BY br.name, pt.name
  `,

  // Production planning
  getVesselAvailability: `
    SELECT
      v.id,
      v.name,
      v.vessel_type,
      v.capacity_bbl,
      v.status,
      vwb.current_batch_id,
      b.batch_number as current_batch_number,
      b.status as batch_status
    FROM vessels v
    LEFT JOIN vessels_with_current_batch vwb ON vwb.id = v.id
    LEFT JOIN batches b ON b.id = vwb.current_batch_id
    WHERE v.is_active = true
    ORDER BY v.name
  `,
};
