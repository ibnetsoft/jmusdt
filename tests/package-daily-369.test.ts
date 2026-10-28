import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {packageDailyTerms,planUnits,rewardPlanInput,validRewardBudget,zeroPlan} from "../src/lib/marketing-plan";

test("369-day budget exception is limited to the exact daily-only package plans",()=>{
  for(const kind of ["lucky","treasure"] as const) {
    const terms=packageDailyTerms[kind],daily=kind==="lucky"?"1000":"10000";
    const input={...zeroPlan,daily,days:369},plan=planUnits(input),price=BigInt(terms.price);
    assert.equal(rewardPlanInput.safeParse(input).success,true);
    assert.equal(rewardPlanInput.safeParse({...input,days:370}).success,false);
    assert.equal(validRewardBudget(plan,price,kind),true);
    assert.equal(validRewardBudget(plan,price,"none"),false);
    assert.equal(validRewardBudget({...plan,referral:"1"},price,kind),false);
    assert.equal(validRewardBudget({...plan,lucky:1},price,kind),false);
    assert.equal(validRewardBudget({...plan,days:368},price,kind),false);
    assert.equal(validRewardBudget(plan,price-1n,kind),false);
  }
});

test("package purchases create 369 daily installments, retain pool participation, fund the full liability and survive schema reruns",async()=>{
  const db=new PGlite();
  const files=["schema.sql","commerce.sql","points.sql","refunds.sql","organization.sql","marketing.sql","member-grades.sql","network-rollup.sql","daily-pools.sql","package-daily-369.sql"];
  const buyers=[crypto.randomUUID(),crypto.randomUUID()],products=[crypto.randomUUID(),crypto.randomUUID()];
  const orders:string[]=[];
  try {
    await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
    for(const f of files) await db.exec(await readFile(new URL("../db/"+f,import.meta.url),"utf8"));
    for(let i=0;i<2;i++) {
      const kind=i===0?"lucky":"treasure",terms=packageDailyTerms[kind];
      const plan=planUnits({...zeroPlan,daily:i===0?"1000":"10000",days:369});
      await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",[buyers[i],buyers[i]+"@example.com"]);
      await db.query("INSERT INTO point_balances(user_id,available) VALUES($1,10000000000000)",[buyers[i]]);
      await db.query("INSERT INTO shop_products(id,name,price,stock,active,package_type,reward_plan) VALUES($1,$2,$3,10,true,$4,$5)",[products[i],kind,terms.price,kind,JSON.stringify(plan)]);
      await assert.rejects(db.query("INSERT INTO shop_products(name,price,stock,active,package_type,reward_plan) VALUES('invalid',$1,10,true,'none',$2)",[terms.price,JSON.stringify(plan)]),/product_reward_budget/);
      await assert.rejects(db.query("UPDATE shop_products SET reward_plan=jsonb_set(reward_plan,'{sponsor}','\"1\"') WHERE id=$1",[products[i]]),/product_reward_budget/);
      const order=(await db.query<{id:string}>("SELECT shop_purchase($1,$2,1,1,$3) AS id",[buyers[i],products[i],crypto.randomUUID()])).rows[0].id;orders.push(order);
      assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM marketing_rewards WHERE order_id=$1 AND type='daily' AND status='scheduled'",[order])).rows[0].n,369);
      assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM marketing_rewards WHERE order_id=$1 AND type<>'daily'",[order])).rows[0].n,0);
      assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM daily_pool_entries WHERE order_id=$1",[order])).rows[0].n,0);
      assert.equal((await db.query<{ok:boolean}>("SELECT member_reward_eligible($1) AS ok",[buyers[i]])).rows[0].ok,true);
      const period=(await db.query<{first:number;last:number;units:string}>("SELECT min(due_date-(o.created_at AT TIME ZONE 'Asia/Seoul')::date)::int AS first,max(due_date-(o.created_at AT TIME ZONE 'Asia/Seoul')::date)::int AS last,sum(r.amount)::text AS units FROM marketing_rewards r JOIN shop_orders o ON o.id=r.order_id WHERE o.id=$1 GROUP BY o.id",[order])).rows[0];
      assert.deepEqual(period,{first:1,last:369,units:(BigInt(terms.daily)*369n).toString()});
    }
    // The legacy repeatable files must not restore a price-only constraint over valid packages.
    for(const f of files) await db.exec(await readFile(new URL("../db/"+f,import.meta.url),"utf8"));
    assert.equal((await db.query<{units:string}>("SELECT sum(units)::text AS units FROM journal WHERE account='shop:revenue'")).rows[0].units,"-209000000000");
    assert.equal((await db.query<{n:number}>("SELECT marketing_run_daily() AS n")).rows[0].n,0);
    await db.query("UPDATE marketing_rewards SET due_date=(now() AT TIME ZONE 'Asia/Seoul')::date WHERE order_id=ANY($1::uuid[])",[orders]);
    let paid=0;
    for(let i=0;i<4;i++) {const n=(await db.query<{n:number}>("SELECT marketing_run_daily() AS n")).rows[0].n;paid+=n;if(!n)break;}
    assert.equal(paid,738);
    assert.equal((await db.query<{n:number}>("SELECT marketing_run_daily() AS n")).rows[0].n,0);
    for(const order of orders) await db.query("SELECT shop_refund($1,$2,'369-day regression')",[order,buyers[0]]);
    for(const buyer of buyers) assert.equal((await db.query<{units:string}>("SELECT available::text AS units FROM point_balances WHERE user_id=$1",[buyer])).rows[0].units,"10000000000000");
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM (SELECT account,asset FROM journal GROUP BY account,asset HAVING sum(units)<>0 AND account IN ('shop:revenue','marketing:reserve')) q")).rows[0].n,0);
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM (SELECT batch_id,asset FROM journal GROUP BY batch_id,asset HAVING sum(units)<>0) q")).rows[0].n,0);
  } finally {await db.close();}
});
