import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
async function setup(legacy = false) {
  const db = new PGlite(),
    user = crypto.randomUUID(),
    actor = crypto.randomUUID(),
    product = crypto.randomUUID();
  await db.exec(
    "CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';",
  );
  const apply = async (file: string) =>
    db.exec(await readFile(new URL("../db/" + file, import.meta.url), "utf8"));
  await apply("schema.sql");
  await apply("commerce.sql");
  if (!legacy) await apply("points.sql");
  await db.query("INSERT INTO auth.users VALUES($1),($2)", [user, actor]);
  await db.query(
    "INSERT INTO profiles(id,email,name) VALUES($1,'buyer@example.com','Buyer'),($2,'admin@example.com','Admin')",
    [user, actor],
  );
  await db.query("INSERT INTO balances(user_id) VALUES($1)", [user]);
  await db.query(
    "SELECT wallet_credit_deposit($1,10000000,'nile','seed',0,100)",
    [user],
  );
  if (!legacy)
    await db.query("SELECT wallet_swap($1,'usdt_to_points',10000000,$2)", [
      user,
      crypto.randomUUID(),
    ]);
  await db.query(
    "INSERT INTO shop_products(id,name,price,stock,active) VALUES($1,'Original',1234567,5,true)",
    [product],
  );
  const order = (
    await db.query<{ id: string }>("SELECT shop_purchase($1,$2,2,1,$3) AS id", [
      user,
      product,
      crypto.randomUUID(),
    ])
  ).rows[0].id;
  if (legacy) await apply("points.sql");
  await apply("refunds.sql");
  return { db, user, actor, product, order, apply };
}
test("full point refund restores original amount and stock exactly once, preserving purchase and balanced journals", async () => {
  const { db, user, actor, order } = await setup();
  try {
    await db.query(
      "UPDATE shop_orders SET status='cancellation_requested',cancellation_reason='Customer request' WHERE id=$1",
      [order],
    );
    await db.exec(
      "UPDATE shop_products SET price=9000000,active=false; UPDATE profiles SET status='blocked' WHERE email='buyer@example.com';",
    );
    const refund = () =>
      db.query<{ id: string }>("SELECT shop_refund($1,$2,$3) AS id", [
        order,
        actor,
        "Approved",
      ]);
    const first = (await refund()).rows[0].id;
    assert.equal((await refund()).rows[0].id, first);
    assert.equal(
      (
        await db.query<{ available: number }>(
          "SELECT available FROM point_balances WHERE user_id=$1",
          [user],
        )
      ).rows[0].available,
      10000000,
    );
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
      (await db.query<{ stock: number }>("SELECT stock FROM shop_products"))
        .rows[0].stock,
      5,
    );
    assert.equal(
      (await db.query("SELECT * FROM transactions WHERE kind='refund'")).rows
        .length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM transactions WHERE kind='purchase' AND status='completed'",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("SELECT * FROM audit_logs WHERE action='order.refunded'"))
        .rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT batch_id,asset FROM journal GROUP BY batch_id,asset HAVING sum(units)<>0",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query("SELECT shop_refund($1,$2,$3)", [
        crypto.randomUUID(),
        actor,
        "missing",
      ]),
      /ORDER_NOT_FOUND/,
    );
    await db.exec("SET ROLE authenticated");
    await assert.rejects(refund(), /permission denied/);
  } finally {
    await db.close();
  }
});
test("legacy USDT orders refund to USDT; repeated schema application preserves refund records", async () => {
  const { db, user, actor, order, apply } = await setup(true);
  try {
    await db.query("SELECT shop_refund($1,$2,'legacy refund')", [order, actor]);
    assert.equal(
      (
        await db.query<{ available: number }>(
          "SELECT available FROM balances WHERE user_id=$1",
          [user],
        )
      ).rows[0].available,
      10000000,
    );
    assert.equal(
      (await db.query("SELECT * FROM point_balances")).rows.length,
      0,
    );
    for (const file of [
      "schema.sql",
      "commerce.sql",
      "points.sql",
      "refunds.sql",
    ])
      await apply(file);
    assert.equal(
      (
        await db.query(
          "SELECT * FROM transactions WHERE kind='refund' AND asset='USDT'",
        )
      ).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
