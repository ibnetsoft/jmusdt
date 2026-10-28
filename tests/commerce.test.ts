import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("shop purchase conserves funds, snapshots prices, deduplicates and rejects stock/price/balance conflicts", async () => {
  const db = new PGlite();
  const user = crypto.randomUUID(),
    product = crypto.randomUUID(),
    key = crypto.randomUUID();
  try {
    await db.exec(
      "CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';",
    );
    for (const file of [
      "schema.sql",
      "commerce.sql",
      "points.sql",
      "product-content.sql",
    ])
      await db.exec(
        await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    await db.query("INSERT INTO auth.users VALUES($1)", [user]);
    await db.query(
      "INSERT INTO profiles(id,email,name) VALUES($1,'shop@example.com','Shop')",
      [user],
    );
    await db.query("INSERT INTO balances(user_id) VALUES($1)", [user]);
    await db.query(
      "SELECT wallet_credit_deposit($1,10000000,'nile','seed',0,100)",
      [user],
    );
    await db.query(
      "INSERT INTO shop_products(id,name,price,stock,active) VALUES($1,'Original',3000000,3,true)",
      [product],
    );
    const buy = (qty: number, version: number, k = crypto.randomUUID()) =>
      db.query("SELECT shop_purchase($1,$2,$3,$4,$5) AS id", [
        user,
        product,
        qty,
        version,
        k,
      ]);
    await db.query("UPDATE shop_products SET detail_blocks=$1", [
      JSON.stringify([{ type: "text", text: "Original detail" }]),
    ]);
    await db.query("SELECT wallet_swap($1,'usdt_to_points',10000000,$2)", [
      user,
      crypto.randomUUID(),
    ]);
    const order = (await buy(2, 1, key)).rows[0];
    await db.query("UPDATE shop_products SET detail_blocks='[]'::jsonb");
    assert.deepEqual(
      (
        await db.query<{ product_detail_blocks: unknown }>(
          "SELECT product_detail_blocks FROM shop_orders",
        )
      ).rows[0].product_detail_blocks,
      [{ type: "text", text: "Original detail" }],
    );
    assert.deepEqual((await buy(2, 1, key)).rows[0], order);
    assert.equal(
      (
        await db.query<{ available: number }>(
          "SELECT available FROM balances WHERE user_id=$1",
          [user],
        )
      ).rows[0].available,
      0,
    );
    assert.equal(
      (await db.query<{ currency: string }>("SELECT currency FROM shop_orders"))
        .rows[0].currency,
      "POINT",
    );
    assert.equal(
      (
        await db.query<{ available: number }>(
          "SELECT available FROM point_balances WHERE user_id=$1",
          [user],
        )
      ).rows[0].available,
      4000000,
    );
    assert.equal(
      (await db.query<{ stock: number }>("SELECT stock FROM shop_products"))
        .rows[0].stock,
      1,
    );
    assert.equal(
      (
        await db.query<{ total: string }>(
          "SELECT sum(units)::text AS total FROM journal",
        )
      ).rows[0].total,
      "0",
    );
    await assert.rejects(buy(1, 1, key), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(buy(2, 2), /OUT_OF_STOCK/);
    await db.query(
      "UPDATE shop_products SET name='Changed',price=9000000,version=2",
    );
    await assert.rejects(buy(1, 1), /PRICE_CHANGED/);
    await assert.rejects(buy(1, 2), /INSUFFICIENT_POINTS/);
    assert.equal(
      (
        await db.query<{ product_name: string }>(
          "SELECT product_name FROM shop_orders",
        )
      ).rows[0].product_name,
      "Original",
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM shop_orders",
        )
      ).rows[0].n,
      1,
    );
    await db.exec("SET ROLE authenticated");
    await assert.rejects(buy(1, 2), /permission denied/);
  } finally {
    await db.close();
  }
});
