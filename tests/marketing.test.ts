import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  planBudget,
  planUnits,
  rewardPlanInput,
  zeroPlan,
} from "../src/lib/marketing-plan";
test("product reward inputs preserve exact micro units and reject malformed plans", () => {
  const p = planUnits({
    ...zeroPlan,
    referral: "0.000001",
    daily: "0.1",
    days: 3,
  });
  assert.equal(p.referral, "1");
  assert.equal(planBudget(p), 300001n);
  assert.equal(
    rewardPlanInput.safeParse({ ...zeroPlan, lucky: 1.5 }).success,
    false,
  );
  assert.equal(
    rewardPlanInput.safeParse({ ...zeroPlan, days: 366 }).success,
    false,
  );
  assert.equal(
    rewardPlanInput.safeParse({ ...zeroPlan, mom: "-1" }).success,
    false,
  );
});
test("marketing: atomic six rewards, snapshot, daily catch-up, cancellation debt recovery, idempotency and RLS", async () => {
  const db = new PGlite();
  const [buyer, ref, sponsor, mom, admin] = Array.from({ length: 5 }, () =>
    crypto.randomUUID(),
  );
  const product = crypto.randomUUID(),
    request = crypto.randomUUID();
  const plan = {
    referral: "10000000",
    sponsor: "5000000",
    mom: "3000000",
    daily: "2000000",
    days: 3,
    lucky: 2,
    treasure: 1,
  };
  const one = async (sql: string, args: unknown[] = []) =>
    (await db.query<Record<string, any>>(sql, args)).rows[0];
  const units = async (id: string) =>
    String(
      (
        await one(
          "SELECT available::text AS v FROM point_balances WHERE user_id=$1",
          [id],
        )
      )?.v || "0",
    );
  try {
    await db.exec(
      "CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';",
    );
    for (const f of [
      "schema.sql",
      "commerce.sql",
      "points.sql",
      "refunds.sql",
      "organization.sql",
      "marketing.sql",
    ])
      await db.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    for (const id of [buyer, ref, sponsor, mom, admin]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
        id,
        id + "@example.com",
      ]);
    }
    await db.query(
      "UPDATE member_network SET referrer_id=$1,sponsor_id=$2,position='L' WHERE user_id=$3",
      [ref, sponsor, buyer],
    );
    await db.query(
      "UPDATE member_network SET referrer_id=$1 WHERE user_id=$2",
      [mom, sponsor],
    );
    await db.query(
      "SELECT wallet_credit_deposit($1,1000000000,'nile','marketing-seed',0,1)",
      [buyer],
    );
    await db.query("SELECT wallet_swap($1,'usdt_to_points',1000000000,$2)", [
      buyer,
      crypto.randomUUID(),
    ]);
    await db.query(
      "INSERT INTO shop_products(id,name,price,stock,active,reward_plan) VALUES($1,'Rewards',100000000,10,true,$2)",
      [product, JSON.stringify(plan)],
    );
    await assert.rejects(
      db.query("UPDATE shop_products SET reward_plan=$1 WHERE id=$2", [
        JSON.stringify({ ...plan, daily: "999999999" }),
        product,
      ]),
      /product_reward_budget/,
    );
    const order = (
      await one("SELECT shop_purchase($1,$2,2,1,$3) AS id", [
        buyer,
        product,
        request,
      ])
    ).id;
    assert.equal(
      (
        await one("SELECT shop_purchase($1,$2,2,1,$3) AS id", [
          buyer,
          product,
          request,
        ])
      ).id,
      order,
    );
    assert.equal(
      (
        await one(
          "SELECT count(*)::int AS n FROM marketing_rewards WHERE order_id=$1",
          [order],
        )
      ).n,
      8,
    );
    assert.equal(await units(ref), "20000000");
    assert.equal(await units(sponsor), "10000000");
    assert.equal(await units(mom), "6000000");
    assert.equal(await units(buyer), "800000000");
    assert.equal(
      (
        await one(
          "SELECT sum(amount)::text AS n FROM marketing_rewards WHERE type='lucky' AND status='paid'",
        )
      ).n,
      "4",
    );
    assert.equal(
      (
        await one(
          "SELECT sum(amount)::text AS n FROM marketing_rewards WHERE type='treasure' AND status='paid'",
        )
      ).n,
      "2",
    );
    assert.equal((await one("SELECT marketing_run_daily() AS n")).n, 0);
    // Editing the product or network cannot change the already issued rights.
    await db.query("UPDATE shop_products SET reward_plan=$1 WHERE id=$2", [
      JSON.stringify(zeroPlan),
      product,
    ]);
    await db.query(
      "UPDATE member_network SET referrer_id=NULL WHERE user_id=$1",
      [buyer],
    );
    assert.equal(
      (
        await one("SELECT reward_snapshot FROM shop_orders WHERE id=$1", [
          order,
        ])
      ).reward_snapshot.referral,
      ref,
    );
    await db.query(
      "UPDATE marketing_rewards SET due_date=(now() AT TIME ZONE 'Asia/Seoul')::date WHERE order_id=$1 AND type='daily' AND installment=1",
      [order],
    );
    await db.query("UPDATE marketing_settings SET daily_paused=true");
    assert.equal((await one("SELECT marketing_run_daily() AS n")).n, 0);
    await db.query("UPDATE marketing_settings SET daily_paused=false");
    await db.query(
      "UPDATE shop_orders SET status='cancellation_requested' WHERE id=$1",
      [order],
    );
    assert.equal((await one("SELECT marketing_run_daily() AS n")).n, 0);
    await db.query("UPDATE shop_orders SET status='paid' WHERE id=$1", [order]);
    assert.equal((await one("SELECT marketing_run_daily() AS n")).n, 1);
    assert.equal((await one("SELECT marketing_run_daily() AS n")).n, 0);
    assert.equal(await units(buyer), "804000000");
    await db.query("SELECT wallet_swap($1,'points_to_usdt',20000000,$2)", [
      ref,
      crypto.randomUUID(),
    ]);
    const refund = (
      await one("SELECT shop_refund($1,$2,'QA') AS id", [order, admin])
    ).id;
    assert.equal(
      (await one("SELECT shop_refund($1,$2,'QA retry') AS id", [order, admin]))
        .id,
      refund,
    );
    assert.equal(await units(buyer), "1000000000");
    assert.equal(await units(sponsor), "0");
    assert.equal(await units(mom), "0");
    assert.equal(
      (await one("SELECT sum(outstanding)::text AS n FROM marketing_debts")).n,
      "20000000",
    );
    assert.equal(
      (
        await one(
          "SELECT count(*)::int AS n FROM marketing_rewards WHERE status='paid'",
        )
      ).n,
      0,
    );
    assert.equal(
      (await one("SELECT stock FROM shop_products WHERE id=$1", [product]))
        .stock,
      10,
    );
    assert.equal((await one("SELECT marketing_run_daily() AS n")).n, 0);
    await db.query("SELECT wallet_swap($1,'usdt_to_points',7000000,$2)", [
      ref,
      crypto.randomUUID(),
    ]);
    assert.equal(await units(ref), "0");
    assert.equal(
      (await one("SELECT sum(outstanding)::text AS n FROM marketing_debts")).n,
      "13000000",
    );
    await db.query("SELECT wallet_swap($1,'usdt_to_points',13000000,$2)", [
      ref,
      crypto.randomUUID(),
    ]);
    assert.equal(await units(ref), "0");
    assert.equal(
      (await one("SELECT sum(outstanding)::text AS n FROM marketing_debts")).n,
      "0",
    );
    assert.equal(
      (
        await one(
          "SELECT coalesce(sum(units),0)::text AS n FROM journal WHERE account='marketing:receivable'",
        )
      ).n,
      "0",
    );
    assert.equal(
      (
        await one(
          "SELECT coalesce(sum(units),0)::text AS n FROM journal WHERE account='marketing:reserve'",
        )
      ).n,
      "0",
    );
    assert.equal(
      (
        await one(
          "SELECT coalesce(sum(units),0)::text AS n FROM journal WHERE account='shop:revenue'",
        )
      ).n,
      "0",
    );
    assert.equal(
      (
        await one(
          "SELECT count(*)::int AS n FROM (SELECT batch_id,asset FROM journal GROUP BY batch_id,asset HAVING sum(units)<>0) b",
        )
      ).n,
      0,
    );
    await db.query("UPDATE marketing_settings SET enabled=false");
    await db.query("UPDATE shop_products SET reward_plan=$1 WHERE id=$2", [
      JSON.stringify(plan),
      product,
    ]);
    const v = (
      await one("SELECT version FROM shop_products WHERE id=$1", [product])
    ).version;
    const off = (
      await one("SELECT shop_purchase($1,$2,1,$3,$4) AS id", [
        buyer,
        product,
        v,
        crypto.randomUUID(),
      ])
    ).id;
    assert.equal(
      (
        await one(
          "SELECT count(*)::int AS n FROM marketing_rewards WHERE order_id=$1",
          [off],
        )
      ).n,
      0,
    );
    // Repeatable deployment does not reject existing reward transaction kinds.
    await db.query("UPDATE marketing_settings SET enabled=true");
    await db.query("UPDATE profiles SET status='blocked' WHERE id=$1", [
      sponsor,
    ]);
    const blockedOrder = (
      await one("SELECT shop_purchase($1,$2,1,$3,$4) AS id", [
        buyer,
        product,
        (await one("SELECT version FROM shop_products WHERE id=$1", [product]))
          .version,
        crypto.randomUUID(),
      ])
    ).id;
    assert.equal(
      (
        await one(
          "SELECT count(*)::int AS n FROM marketing_rewards WHERE order_id=$1 AND type IN ('referral','sponsor','mom') AND status='skipped'",
          [blockedOrder],
        )
      ).n,
      3,
    );
    await db.query(
      "UPDATE marketing_rewards SET due_date=(now() AT TIME ZONE 'Asia/Seoul')::date WHERE order_id=$1 AND type='daily'",
      [blockedOrder],
    );
    await db.query("UPDATE profiles SET status='blocked' WHERE id=$1", [buyer]);
    assert.equal(
      (await one("SELECT marketing_run_daily($1) AS n", [blockedOrder])).n,
      0,
    );
    await db.query("UPDATE profiles SET status='active' WHERE id=$1", [buyer]);
    assert.equal(
      (await one("SELECT marketing_run_daily($1) AS n", [blockedOrder])).n,
      3,
    );
    await db.query("SELECT shop_refund($1,$2,'blocked recipient QA')", [
      blockedOrder,
      admin,
    ]);
    for (const f of [
      "commerce.sql",
      "points.sql",
      "refunds.sql",
      "marketing.sql",
    ])
      await db.exec(
        await readFile(new URL("../db/" + f, import.meta.url), "utf8"),
      );
    await db.exec("SET ROLE authenticated");
    assert.equal(
      (await one("SELECT count(*)::int AS n FROM marketing_rewards")).n,
      0,
    );
    await assert.rejects(
      db.query("SELECT marketing_run_daily()"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("UPDATE marketing_settings SET enabled=true"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
