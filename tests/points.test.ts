import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("points migration preserves legacy USDT orders and is repeatable", async () => {
  const db = new PGlite(),
    user = crypto.randomUUID(),
    product = crypto.randomUUID();
  try {
    await db.exec(
      "CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';",
    );
    const sql = async (file: string) =>
      db.exec(
        await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    await sql("schema.sql");
    await sql("commerce.sql");
    await db.query("INSERT INTO auth.users VALUES($1)", [user]);
    await db.query(
      "INSERT INTO profiles(id,email,name) VALUES($1,'legacy@example.com','Legacy')",
      [user],
    );
    await db.query("INSERT INTO balances(user_id) VALUES($1)", [user]);
    await db.query(
      "SELECT wallet_credit_deposit($1,2000000,'nile','seed',0,1)",
      [user],
    );
    await db.query(
      "INSERT INTO shop_products(id,name,price,stock,active) VALUES($1,'Legacy',1000000,2,true)",
      [product],
    );
    await db.query("SELECT shop_purchase($1,$2,1,1,$3)", [
      user,
      product,
      crypto.randomUUID(),
    ]);
    await sql("points.sql");
    await sql("points.sql");
    assert.equal(
      (await db.query<{ currency: string }>("SELECT currency FROM shop_orders"))
        .rows[0].currency,
      "USDT",
    );
    assert.equal(
      (
        await db.query<{ asset: string }>(
          "SELECT asset FROM transactions WHERE kind='purchase'",
        )
      ).rows[0].asset,
      "USDT",
    );
    assert.equal(
      (await db.query<{ available: number }>("SELECT available FROM balances"))
        .rows[0].available,
      1000000,
    );
    assert.equal(
      (await db.query<{ version: number }>("SELECT version FROM shop_products"))
        .rows[0].version,
      3,
    );
  } finally {
    await db.close();
  }
});
test("points swaps are exact, bidirectional, per-asset balanced, idempotent and access controlled", async () => {
  const db = new PGlite();
  const user = crypto.randomUUID(),
    key = crypto.randomUUID();
  try {
    await db.exec(
      "CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';",
    );
    for (const file of ["schema.sql", "commerce.sql", "points.sql"])
      await db.exec(
        await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    await db.query("INSERT INTO auth.users VALUES($1)", [user]);
    await db.query(
      "INSERT INTO profiles(id,email,name) VALUES($1,'points@example.com','Points')",
      [user],
    );
    await db.query("INSERT INTO balances(user_id) VALUES($1)", [user]);
    await db.query(
      "SELECT wallet_credit_deposit($1,10000000,'nile','seed',0,100)",
      [user],
    );
    const swap = (
      direction: string,
      amount: number,
      request = crypto.randomUUID(),
    ) =>
      db.query("SELECT wallet_swap($1,$2,$3,$4) AS id", [
        user,
        direction,
        amount,
        request,
      ]);
    const first = await swap("usdt_to_points", 1234567, key);
    assert.deepEqual(
      (await swap("usdt_to_points", 1234567, key)).rows,
      first.rows,
    );
    const balance = async () =>
      (
        await db.query<{ usdt: number; points: number }>(
          "SELECT b.available AS usdt,p.available AS points FROM balances b JOIN point_balances p ON p.user_id=b.user_id WHERE b.user_id=$1",
          [user],
        )
      ).rows[0];
    assert.deepEqual(await balance(), { usdt: 8765433, points: 1234567 });
    await assert.rejects(
      swap("points_to_usdt", 1234567, key),
      /IDEMPOTENCY_CONFLICT/,
    );
    await assert.rejects(
      swap("points_to_usdt", 1234568),
      /INSUFFICIENT_POINTS/,
    );
    await assert.rejects(
      swap("usdt_to_points", 10000000),
      /INSUFFICIENT_BALANCE/,
    );
    await assert.rejects(swap("usdt_to_points", 0), /INVALID_SWAP/);
    await swap("points_to_usdt", 1234567);
    assert.deepEqual(await balance(), { usdt: 10000000, points: 0 });
    assert.equal(
      (
        await db.query(
          "SELECT batch_id,asset FROM journal GROUP BY batch_id,asset HAVING sum(units)<>0",
        )
      ).rows.length,
      0,
    );
    assert.equal((await db.query("SELECT * FROM point_swaps")).rows.length, 2);
    await db.query("UPDATE profiles SET status='blocked' WHERE id=$1", [user]);
    await assert.rejects(swap("usdt_to_points", 1), /ACCOUNT_BLOCKED/);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(swap("usdt_to_points", 1), /permission denied/);
  } finally {
    await db.close();
  }
});
