import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { productInput, productPrice, productRetailPrice } from "../src/lib/commerce";
import { planUnits, zeroPlan } from "../src/lib/marketing-plan";

test("consumer price is optional comparison data and cannot undercut the charged member price", () => {
  const price = productPrice("88000");
  assert.equal(productRetailPrice("98000", price), "98000000000");
  assert.equal(productRetailPrice("88000", price), price);
  assert.equal(productRetailPrice("", price), null);
  assert.equal(productRetailPrice(undefined, price), undefined);
  assert.throws(() => productRetailPrice("87999.999999", price), /소비자가/);
  assert.equal(productInput.shape.retailPrice.safeParse("98000.0000001").success, false);
});

test("척척보감 charges 88,000 P, pays real-time rewards and accrues company pools with no daily allowance", async () => {
  const db = new PGlite();
  const [mom, ref, buyer, product, request] = Array.from({ length: 5 }, () => crypto.randomUUID());
  const plan = planUnits({ ...zeroPlan, referral: "9000", sponsor: "4500", mom: "4500", lucky: 3000, treasure: 3000 });
  try {
    await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
    for (const file of ["schema.sql", "commerce.sql", "points.sql", "refunds.sql", "organization.sql", "marketing.sql", "member-grades.sql", "network-rollup.sql", "daily-pools.sql", "package-daily-369.sql", "product-pricing.sql"])
      await db.exec(await readFile(new URL("../db/" + file, import.meta.url), "utf8"));
    let code = "";
    for (const id of [mom, ref, buyer]) {
      await db.query("INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,$2,now(),$3)", [id, id + "@example.com", JSON.stringify({ referral_code: code })]);
      if (id !== buyer) await db.query("UPDATE profiles SET grade_code='vip' WHERE id=$1", [id]);
      code = (await db.query<{ referral_code: string }>("SELECT referral_code FROM member_network WHERE user_id=$1", [id])).rows[0].referral_code;
    }
    await db.query("INSERT INTO point_balances(user_id,available) VALUES($1,100000000000)", [buyer]);
    await db.query("INSERT INTO shop_products(id,name,price,retail_price,stock,active,reward_plan) VALUES($1,'척척보감',88000000000,98000000000,100,true,$2)", [product, JSON.stringify(plan)]);
    const buy = () => db.query<{ id: string }>("SELECT shop_purchase($1,$2,1,1,$3) AS id", [buyer, product, request]);
    const order = (await buy()).rows[0].id;
    assert.equal((await buy()).rows[0].id, order);
    assert.deepEqual((await db.query("SELECT unit_price::text,total::text,currency,quantity FROM shop_orders WHERE id=$1", [order])).rows[0], { unit_price: "88000000000", total: "88000000000", currency: "POINT", quantity: 1 });
    assert.equal((await db.query<{ available: string }>("SELECT available::text FROM point_balances WHERE user_id=$1", [buyer])).rows[0].available, "12000000000");
    assert.deepEqual((await db.query("SELECT type,amount::text,status FROM marketing_rewards WHERE order_id=$1 ORDER BY type", [order])).rows, [
      { type: "mom", amount: "4500000000", status: "paid" },
      { type: "referral", amount: "9000000000", status: "paid" },
      { type: "sponsor", amount: "4500000000", status: "paid" },
    ]);
    assert.deepEqual((await db.query("SELECT kind,amount::text FROM daily_pool_entries WHERE order_id=$1 ORDER BY kind", [order])).rows, [
      { kind: "lucky", amount: "3000000000" }, { kind: "treasure", amount: "3000000000" },
    ]);
    await assert.rejects(db.query("UPDATE shop_products SET retail_price=87999999999 WHERE id=$1", [product]), /product_retail_price_check/);
    await db.exec(await readFile(new URL("../db/product-pricing.sql", import.meta.url), "utf8"));
    await db.query("UPDATE shop_products SET retail_price=NULL WHERE id=$1", [product]);
    await db.query("SELECT shop_refund($1,$2,'pricing regression')", [order, mom]);
    assert.equal((await db.query<{ available: string }>("SELECT available::text FROM point_balances WHERE user_id=$1", [buyer])).rows[0].available, "100000000000");
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM daily_pool_entries WHERE order_id=$1 AND cancelled_at IS NOT NULL", [order])).rows[0].n, 2);
  } finally { await db.close(); }
});
