/**
 * Real-Postgres regressions for atomic recipe editor saves (#446).
 *
 * The browser can prove the editor sends one request, but only Postgres can
 * prove rollback and locking behavior across the recipe plus six child tables.
 */

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });

const SECTION_TABLES = [
  "recipe_malts",
  "recipe_hops",
  "recipe_adjuncts",
  "recipe_sugars",
  "recipe_spices",
  "recipe_fruits",
] as const;

type Fixture = {
  recipeId: string;
  sections: Record<(typeof SECTION_TABLES)[number], Array<Record<string, unknown>>>;
};

afterAll(async () => {
  await pool.end();
});

async function createFixture(db: PoolClient, label: string): Promise<Fixture> {
  const recipeId = randomUUID();
  const catalogIds = {
    malt: randomUUID(),
    hop: randomUUID(),
    adjunct: randomUUID(),
    sugar: randomUUID(),
    spice: randomUUID(),
    fruit: randomUUID(),
  };

  await db.query("INSERT INTO recipes (id, name, status) VALUES ($1, $2, 'draft')", [
    recipeId,
    `Atomic recipe ${label}`,
  ]);
  await db.query(
    "INSERT INTO malts (id, name, color_lovibond, potential_ppg) VALUES ($1, $2, 3, 37)",
    [catalogIds.malt, `Malt ${label}`],
  );
  await db.query(
    "INSERT INTO hops (id, name, alpha_acid_typical) VALUES ($1, $2, 12)",
    [catalogIds.hop, `Hop ${label}`],
  );
  await db.query("INSERT INTO adjuncts (id, name) VALUES ($1, $2)", [
    catalogIds.adjunct, `Adjunct ${label}`,
  ]);
  await db.query("INSERT INTO sugars (id, name) VALUES ($1, $2)", [
    catalogIds.sugar, `Sugar ${label}`,
  ]);
  await db.query("INSERT INTO spices (id, name) VALUES ($1, $2)", [
    catalogIds.spice, `Spice ${label}`,
  ]);
  await db.query("INSERT INTO fruits (id, name) VALUES ($1, $2)", [
    catalogIds.fruit, `Fruit ${label}`,
  ]);

  return {
    recipeId,
    sections: {
      recipe_malts: [{ id: randomUUID(), malt_id: catalogIds.malt, weight_lbs: 42, notes: "base" }],
      recipe_hops: [{ id: randomUUID(), hop_id: catalogIds.hop, weight_oz: 8, timing: "boil", boil_time_min: 60, notes: "bittering" }],
      recipe_adjuncts: [{ id: randomUUID(), adjunct_id: catalogIds.adjunct, weight_lbs: 3, timing: "mash", notes: null }],
      recipe_sugars: [{ id: randomUUID(), sugar_id: catalogIds.sugar, weight_lbs: 2, timing: "boil", notes: null }],
      recipe_spices: [{ id: randomUUID(), spice_id: catalogIds.spice, amount: 1, unit: "oz", timing: "boil", boil_time_min: 5, notes: null }],
      recipe_fruits: [{ id: randomUUID(), fruit_id: catalogIds.fruit, amount: 10, unit: "lbs", timing: "secondary", notes: null }],
    },
  };
}

async function saveRecipe(
  db: PoolClient,
  fixture: Fixture,
  expectedVersion: number,
  recipePatch: Record<string, unknown>,
  sections: Partial<Fixture["sections"]>,
) {
  const { rows } = await db.query<{ result: { version: number } }>(
    `SELECT save_recipe_aggregate_atomic($1, $2, $3::jsonb, $4::jsonb) AS result`,
    [
      fixture.recipeId,
      expectedVersion,
      JSON.stringify(recipePatch),
      JSON.stringify(sections),
    ],
  );
  return rows[0]!.result;
}

async function childCounts(db: PoolClient, recipeId: string) {
  const result: Record<string, number> = {};
  for (const table of SECTION_TABLES) {
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table} WHERE recipe_id = $1`,
      [recipeId],
    );
    result[table] = Number(rows[0]!.count);
  }
  return result;
}

describe("save_recipe_aggregate_atomic", () => {
  it("is invoker-rights and unavailable to anon", async () => {
    const { rows } = await pool.query<{
      anon_can_execute: boolean;
      authenticated_can_execute: boolean;
      is_security_definer: boolean;
      settings: string[] | null;
    }>(`
      SELECT
        has_function_privilege(
          'anon',
          'save_recipe_aggregate_atomic(uuid,integer,jsonb,jsonb)',
          'EXECUTE'
        ) AS anon_can_execute,
        has_function_privilege(
          'authenticated',
          'save_recipe_aggregate_atomic(uuid,integer,jsonb,jsonb)',
          'EXECUTE'
        ) AS authenticated_can_execute,
        prosecdef AS is_security_definer,
        proconfig AS settings
      FROM pg_proc
      WHERE oid = 'save_recipe_aggregate_atomic(uuid,integer,jsonb,jsonb)'::regprocedure
    `);

    expect(rows[0]).toEqual({
      anon_can_execute: false,
      authenticated_can_execute: true,
      is_security_definer: false,
      settings: ["search_path=public"],
    });
  });

  it("commits the recipe patch and all six child sections with one version bump", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const fixture = await createFixture(db, "success");

      const result = await saveRecipe(db, fixture, 1, { name: "Committed atomically" }, fixture.sections);

      expect(result).toEqual({ version: 2 });
      const recipe = await db.query<{ name: string; version: number }>(
        "SELECT name, version FROM recipes WHERE id = $1",
        [fixture.recipeId],
      );
      expect(recipe.rows[0]).toEqual({ name: "Committed atomically", version: 2 });
      expect(await childCounts(db, fixture.recipeId)).toEqual(
        Object.fromEntries(SECTION_TABLES.map((table) => [table, 1])),
      );

      const snapshots = await db.query<{ color_lov: string; ppg: number; alpha_acid: string }>(
        `SELECT rm.color_lov::text, rm.ppg, rh.alpha_acid::text
           FROM recipe_malts rm
           JOIN recipe_hops rh ON rh.recipe_id = rm.recipe_id
          WHERE rm.recipe_id = $1`,
        [fixture.recipeId],
      );
      expect(snapshots.rows[0]).toEqual({ color_lov: "3.0", ppg: 37, alpha_acid: "12.00" });
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });

  it("distinguishes an omitted section from an explicit empty replacement", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const fixture = await createFixture(db, "omitted-empty");
      await saveRecipe(db, fixture, 1, {}, {
        recipe_malts: fixture.sections.recipe_malts,
        recipe_hops: fixture.sections.recipe_hops,
      });

      const second = await saveRecipe(db, fixture, 2, {}, { recipe_malts: [] });

      expect(second).toEqual({ version: 3 });
      expect(await childCounts(db, fixture.recipeId)).toMatchObject({
        recipe_malts: 0,
        recipe_hops: 1,
      });
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });

  it("rolls back the parent and earlier child sections when a later section fails", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const fixture = await createFixture(db, "rollback");
      await db.query(`
        CREATE FUNCTION pg_temp.fail_recipe_fruit_save()
        RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
          IF NEW.recipe_id = '${fixture.recipeId}'::uuid THEN
            RAISE EXCEPTION 'injected fruit failure';
          END IF;
          RETURN NEW;
        END;
        $body$;
        CREATE TRIGGER fail_recipe_fruit_save
          BEFORE INSERT OR UPDATE ON recipe_fruits
          FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_recipe_fruit_save();
      `);
      await db.query("SAVEPOINT before_save");

      await expect(
        saveRecipe(db, fixture, 1, { name: "Must roll back" }, fixture.sections),
      ).rejects.toThrow("injected fruit failure");
      await db.query("ROLLBACK TO SAVEPOINT before_save");

      const recipe = await db.query<{ name: string; version: number }>(
        "SELECT name, version FROM recipes WHERE id = $1",
        [fixture.recipeId],
      );
      expect(recipe.rows[0]).toEqual({ name: "Atomic recipe rollback", version: 1 });
      expect(await childCounts(db, fixture.recipeId)).toEqual(
        Object.fromEntries(SECTION_TABLES.map((table) => [table, 0])),
      );
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });

  it("allows exactly one of two writers at the same version", async () => {
    const seed = await pool.connect();
    let fixture: Fixture;
    try {
      fixture = await createFixture(seed, `race-${randomUUID()}`);
    } finally {
      seed.release();
    }
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      const firstSections = {
        recipe_malts: [{ ...fixture.sections.recipe_malts[0], weight_lbs: 11 }],
      };
      const secondSections = {
        recipe_malts: [{ ...fixture.sections.recipe_malts[0], weight_lbs: 22 }],
      };
      const outcomes = await Promise.allSettled([
        saveRecipe(first, fixture, 1, { name: "Writer A" }, firstSections),
        saveRecipe(second, fixture, 1, { name: "Writer B" }, secondSections),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      expect(String(rejected && rejected.status === "rejected" ? rejected.reason : ""))
        .toContain("version conflict");
      expect(
        rejected && rejected.status === "rejected"
          ? (rejected.reason as { code?: string }).code
          : undefined,
      ).toBe("PT409");

      const final = await pool.query<{ name: string; version: number; weight_lbs: string }>(
        `SELECT r.name, r.version, rm.weight_lbs::text
           FROM recipes r
           JOIN recipe_malts rm ON rm.recipe_id = r.id
          WHERE r.id = $1`,
        [fixture.recipeId],
      );
      expect(final.rows[0]!.version).toBe(2);
      expect([
        { name: "Writer A", weight_lbs: "11.0000" },
        { name: "Writer B", weight_lbs: "22.0000" },
      ]).toContainEqual({
        name: final.rows[0]!.name,
        weight_lbs: final.rows[0]!.weight_lbs,
      });
      expect((await childCounts(first, fixture.recipeId)).recipe_malts).toBe(1);
    } finally {
      first.release();
      second.release();
      await pool.query("DELETE FROM recipes WHERE id = $1", [fixture.recipeId]);
    }
  });

  it("rejects a stale retry without changing or duplicating rows", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const fixture = await createFixture(db, "stale-retry");
      await saveRecipe(db, fixture, 1, { name: "First commit" }, {
        recipe_malts: fixture.sections.recipe_malts,
      });
      await db.query("SAVEPOINT before_stale_retry");

      await expect(
        saveRecipe(db, fixture, 1, { name: "Stale overwrite" }, {
          recipe_malts: [{ ...fixture.sections.recipe_malts[0], weight_lbs: 99 }],
        }),
      ).rejects.toThrow("version conflict");
      await db.query("ROLLBACK TO SAVEPOINT before_stale_retry");

      const final = await db.query<{ name: string; version: number; count: string; weight: string }>(
        `SELECT r.name, r.version, count(rm.id)::text AS count,
                max(rm.weight_lbs)::text AS weight
           FROM recipes r
           LEFT JOIN recipe_malts rm ON rm.recipe_id = r.id
          WHERE r.id = $1
          GROUP BY r.id`,
        [fixture.recipeId],
      );
      expect(final.rows[0]).toEqual({
        name: "First commit",
        version: 2,
        count: "1",
        weight: "42.0000",
      });
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });
});
