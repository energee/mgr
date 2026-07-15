/**
 * Real-Postgres regressions for atomic, category-scoped recipe additions (#480).
 */

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });

type AdditionInput = {
  id?: string;
  additive_id: string;
  amount: number;
  unit: string;
  timing: string;
  target?: string | null;
};

type Fixture = {
  recipeId: string;
  otherRecipeId: string;
  waterAdditiveId: string;
  secondWaterAdditiveId: string;
  otherAdditiveId: string;
  oldWaterAdditionId: string;
  oldOtherAdditionId: string;
  ownerlessAdditionId: string;
};

afterAll(async () => {
  await pool.end();
});

async function createFixture(db: PoolClient, label: string): Promise<Fixture> {
  const fixture: Fixture = {
    recipeId: randomUUID(),
    otherRecipeId: randomUUID(),
    waterAdditiveId: randomUUID(),
    secondWaterAdditiveId: randomUUID(),
    otherAdditiveId: randomUUID(),
    oldWaterAdditionId: randomUUID(),
    oldOtherAdditionId: randomUUID(),
    ownerlessAdditionId: randomUUID(),
  };

  await db.query(
    "INSERT INTO recipes (id, name, status) VALUES ($1, $2, 'draft'), ($3, $4, 'draft')",
    [fixture.recipeId, `Atomic additions ${label}`, fixture.otherRecipeId, `Other recipe ${label}`],
  );
  await db.query(
    `INSERT INTO additives (id, name, type) VALUES
      ($1, $2, 'water_salt'), ($3, $4, 'acid'), ($5, $6, 'clarifier')`,
    [
      fixture.waterAdditiveId, `Gypsum ${label}`,
      fixture.secondWaterAdditiveId, `Lactic acid ${label}`,
      fixture.otherAdditiveId, `Whirlfloc ${label}`,
    ],
  );
  await db.query(
    `INSERT INTO recipe_additions
      (id, recipe_id, additive_id, amount, unit, timing, target, is_default, position)
     VALUES
      ($1, $2, $3, 1, 'g', 'mash', 'mash', false, 0),
      ($4, $2, $5, 1, 'tablets', 'boil', NULL, false, 0),
      ($6, NULL, $3, 2, 'g', 'mash', 'mash', true, 0)`,
    [
      fixture.oldWaterAdditionId,
      fixture.recipeId,
      fixture.waterAdditiveId,
      fixture.oldOtherAdditionId,
      fixture.otherAdditiveId,
      fixture.ownerlessAdditionId,
    ],
  );

  return fixture;
}

async function replaceAdditions(
  db: PoolClient,
  fixture: Fixture,
  expectedVersion: number,
  scope: "water_chemistry" | "other",
  items: AdditionInput[] | null,
) {
  const { rows } = await db.query<{ result: { version: number } }>(
    "SELECT replace_recipe_additions_atomic($1, $2, $3, $4::jsonb) AS result",
    [fixture.recipeId, expectedVersion, scope, items === null ? null : JSON.stringify(items)],
  );
  return rows[0]!.result;
}

async function recipeRows(db: PoolClient, recipeId: string) {
  const { rows } = await db.query<{
    id: string;
    additive_id: string;
    type: string;
    amount: string;
  }>(
    `SELECT ra.id, ra.additive_id, a.type, ra.amount::text
       FROM recipe_additions ra
       JOIN additives a ON a.id = ra.additive_id
      WHERE ra.recipe_id = $1
      ORDER BY a.type, ra.position, ra.id`,
    [recipeId],
  );
  return rows;
}

describe("replace_recipe_additions_atomic", () => {
  it("is invoker-rights, search-path pinned, and unavailable to anon", async () => {
    const { rows } = await pool.query<{
      anon_can_execute: boolean;
      authenticated_can_execute: boolean;
      is_security_definer: boolean;
      settings: string[] | null;
    }>(`
      SELECT
        has_function_privilege(
          'anon',
          'replace_recipe_additions_atomic(uuid,integer,text,jsonb)',
          'EXECUTE'
        ) AS anon_can_execute,
        has_function_privilege(
          'authenticated',
          'replace_recipe_additions_atomic(uuid,integer,text,jsonb)',
          'EXECUTE'
        ) AS authenticated_can_execute,
        prosecdef AS is_security_definer,
        proconfig AS settings
      FROM pg_proc
      WHERE oid = 'replace_recipe_additions_atomic(uuid,integer,text,jsonb)'::regprocedure
    `);

    expect(rows[0]).toEqual({
      anon_can_execute: false,
      authenticated_can_execute: true,
      is_security_definer: false,
      settings: ["search_path=public"],
    });
  });

  it("replaces only the requested category and preserves ownerless/default rows", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const fixture = await createFixture(db, "scope");
      const newId = randomUUID();

      const result = await replaceAdditions(db, fixture, 1, "water_chemistry", [{
        id: newId,
        additive_id: fixture.secondWaterAdditiveId,
        amount: 3.5,
        unit: "ml",
        timing: "mash",
        target: "mash",
      }]);

      expect(result).toEqual({ version: 2 });
      expect(await recipeRows(db, fixture.recipeId)).toEqual([
        {
          id: newId,
          additive_id: fixture.secondWaterAdditiveId,
          type: "acid",
          amount: "3.5000",
        },
        {
          id: fixture.oldOtherAdditionId,
          additive_id: fixture.otherAdditiveId,
          type: "clarifier",
          amount: "1.0000",
        },
      ]);
      const ownerless = await db.query<{ id: string }>(
        "SELECT id FROM recipe_additions WHERE id = $1 AND recipe_id IS NULL",
        [fixture.ownerlessAdditionId],
      );
      expect(ownerless.rows).toEqual([{ id: fixture.ownerlessAdditionId }]);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });

  it("distinguishes an omitted replacement from an explicit empty category", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const fixture = await createFixture(db, "omitted-empty");

      expect(await replaceAdditions(db, fixture, 1, "other", null)).toEqual({ version: 1 });
      expect(await recipeRows(db, fixture.recipeId)).toHaveLength(2);

      expect(await replaceAdditions(db, fixture, 1, "other", [])).toEqual({ version: 2 });
      expect(await recipeRows(db, fixture.recipeId)).toEqual([
        expect.objectContaining({ id: fixture.oldWaterAdditionId, type: "water_salt" }),
      ]);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });

  it("rolls back deletion and version bump when inserting a replacement fails", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const fixture = await createFixture(db, "rollback");
      await db.query(`
        CREATE FUNCTION pg_temp.fail_recipe_addition_save()
        RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
          IF NEW.recipe_id = '${fixture.recipeId}'::uuid
             AND NEW.additive_id = '${fixture.secondWaterAdditiveId}'::uuid THEN
            RAISE EXCEPTION 'injected recipe addition failure';
          END IF;
          RETURN NEW;
        END;
        $body$;
        CREATE TRIGGER fail_recipe_addition_save
          BEFORE INSERT ON recipe_additions
          FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_recipe_addition_save();
      `);
      await db.query("SAVEPOINT before_replace");

      await expect(replaceAdditions(db, fixture, 1, "water_chemistry", [{
        additive_id: fixture.secondWaterAdditiveId,
        amount: 2,
        unit: "ml",
        timing: "mash",
        target: "mash",
      }])).rejects.toThrow("injected recipe addition failure");
      await db.query("ROLLBACK TO SAVEPOINT before_replace");

      expect(await recipeRows(db, fixture.recipeId)).toEqual([
        expect.objectContaining({ id: fixture.oldOtherAdditionId, type: "clarifier" }),
        expect.objectContaining({ id: fixture.oldWaterAdditionId, type: "water_salt" }),
      ]);
      const recipe = await db.query<{ version: number }>(
        "SELECT version FROM recipes WHERE id = $1",
        [fixture.recipeId],
      );
      expect(recipe.rows[0]!.version).toBe(1);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });

  it("rejects an additive outside the requested category without changing rows", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const fixture = await createFixture(db, "category-validation");
      await db.query("SAVEPOINT before_replace");

      await expect(replaceAdditions(db, fixture, 1, "water_chemistry", [{
        additive_id: fixture.otherAdditiveId,
        amount: 1,
        unit: "tablets",
        timing: "boil",
      }])).rejects.toThrow("does not belong to scope water_chemistry");
      await db.query("ROLLBACK TO SAVEPOINT before_replace");

      expect(await recipeRows(db, fixture.recipeId)).toHaveLength(2);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });

  it("allows exactly one of two writers at the same recipe version", async () => {
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
      const firstId = randomUUID();
      const secondId = randomUUID();
      const outcomes = await Promise.allSettled([
        replaceAdditions(first, fixture, 1, "water_chemistry", [{
          id: firstId,
          additive_id: fixture.waterAdditiveId,
          amount: 11,
          unit: "g",
          timing: "mash",
          target: "mash",
        }]),
        replaceAdditions(second, fixture, 1, "water_chemistry", [{
          id: secondId,
          additive_id: fixture.secondWaterAdditiveId,
          amount: 22,
          unit: "ml",
          timing: "mash",
          target: "mash",
        }]),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      expect(String(rejected?.status === "rejected" ? rejected.reason : ""))
        .toContain("version conflict");
      expect(
        rejected?.status === "rejected"
          ? (rejected.reason as { code?: string }).code
          : undefined,
      ).toBe("PT409");

      const final = await pool.query<{ version: number; id: string; amount: string }>(
        `SELECT r.version, ra.id, ra.amount::text
           FROM recipes r
           JOIN recipe_additions ra ON ra.recipe_id = r.id
           JOIN additives a ON a.id = ra.additive_id
          WHERE r.id = $1 AND a.type IN ('water_salt', 'acid')`,
        [fixture.recipeId],
      );
      expect(final.rows).toHaveLength(1);
      expect(final.rows[0]!.version).toBe(2);
      expect([
        { id: firstId, amount: "11.0000" },
        { id: secondId, amount: "22.0000" },
      ]).toContainEqual({ id: final.rows[0]!.id, amount: final.rows[0]!.amount });
    } finally {
      first.release();
      second.release();
      await pool.query("DELETE FROM recipes WHERE id IN ($1, $2)", [
        fixture.recipeId,
        fixture.otherRecipeId,
      ]);
      await pool.query("DELETE FROM recipe_additions WHERE id = $1", [fixture.ownerlessAdditionId]);
      await pool.query("DELETE FROM additives WHERE id IN ($1, $2, $3)", [
        fixture.waterAdditiveId,
        fixture.secondWaterAdditiveId,
        fixture.otherAdditiveId,
      ]);
    }
  });

  it("rejects a stale retry without changing the committed category", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const fixture = await createFixture(db, "stale");
      const committedId = randomUUID();
      await replaceAdditions(db, fixture, 1, "other", [{
        id: committedId,
        additive_id: fixture.otherAdditiveId,
        amount: 2,
        unit: "tablets",
        timing: "boil",
      }]);
      await db.query("SAVEPOINT before_stale");

      await expect(replaceAdditions(db, fixture, 1, "other", []))
        .rejects.toThrow("version conflict");
      await db.query("ROLLBACK TO SAVEPOINT before_stale");

      expect(await recipeRows(db, fixture.recipeId)).toEqual([
        expect.objectContaining({ id: committedId, type: "clarifier", amount: "2.0000" }),
        expect.objectContaining({ id: fixture.oldWaterAdditionId, type: "water_salt" }),
      ]);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });
});
