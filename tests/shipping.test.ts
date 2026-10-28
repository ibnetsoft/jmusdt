import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("shipping data is private, one per order, and constrained to valid delivery states", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE shop_orders(id uuid PRIMARY KEY); CREATE TABLE shop_products(id uuid PRIMARY KEY);");
    const sql = await readFile(new URL("../db/shipping.sql", import.meta.url), "utf8");
    await db.exec(sql);
    const product = crypto.randomUUID();
    await db.query("INSERT INTO shop_products(id) VALUES($1)", [product]);
    assert.equal((await db.query<{shipping_type:string|null}>("SELECT shipping_type FROM shop_products WHERE id=$1",[product])).rows[0].shipping_type, null);
    await assert.rejects(db.query("UPDATE shop_products SET shipping_type='invalid' WHERE id=$1",[product]));
    await db.exec(sql);
    const order = crypto.randomUUID();
    await db.query("INSERT INTO shop_orders VALUES($1)", [order]);
    await db.query("INSERT INTO shop_order_shipping(order_id,recipient,phone,address) VALUES($1,'Test','010','Test address')", [order]);
    const row = (await db.query<{status:string}>("SELECT status FROM shop_order_shipping WHERE order_id=$1", [order])).rows[0];
    assert.equal(row.status, "preparing");
    await assert.rejects(db.query("UPDATE shop_order_shipping SET status='invalid' WHERE order_id=$1", [order]));
    await assert.rejects(db.query("INSERT INTO shop_order_shipping(order_id,recipient,phone,address) VALUES($1,'Test','010','Test address')", [order]));
    const privileges = (await db.query<{rls:boolean; anon_read:boolean; member_read:boolean}>("SELECT relrowsecurity AS rls,has_table_privilege('anon','shop_order_shipping','SELECT') AS anon_read,has_table_privilege('authenticated','shop_order_shipping','SELECT') AS member_read FROM pg_class WHERE oid='shop_order_shipping'::regclass")).rows[0];
    assert.deepEqual(privileges, {rls:true,anon_read:false,member_read:false});
  } finally { await db.close(); }
});
