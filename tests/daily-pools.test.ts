import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("daily pools credit weighted package holders once, retain remainder, and cancel unspent contributions on refund",async()=>{
 const db=new PGlite(); const [one,two,buyer,admin]=Array.from({length:4},()=>crypto.randomUUID()); const pack=crypto.randomUUID(),goods=crypto.randomUUID();
 try {
  await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
  for(const f of ['schema.sql','commerce.sql','points.sql','refunds.sql','organization.sql','marketing.sql','member-grades.sql','network-rollup.sql','daily-pools.sql'])await db.exec(await readFile(new URL('../db/'+f,import.meta.url),'utf8'));
  for(const id of [one,two,buyer,admin]) {await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",[id,id+'@example.com']);await db.query("INSERT INTO point_balances(user_id,available) VALUES($1,2000000000000)",[id]);}
  await db.exec("UPDATE profiles SET grade_code='vip';UPDATE marketing_settings SET enabled=false WHERE id=true");
  await db.query("INSERT INTO shop_products(id,name,price,stock,active,package_type) VALUES($1,'package',350000000000,20,true,'lucky')",[pack]);
  await db.query("INSERT INTO shop_products(id,name,price,stock,active,reward_plan) VALUES($1,'goods',100000000,20,true,$2)",[goods,JSON.stringify({referral:'0',sponsor:'0',mom:'0',daily:'0',days:0,lucky:7,treasure:5})]);
  const buy=async(user:string,product:string,qty:number,version:number)=>(await db.query<{id:string}>("SELECT shop_purchase($1,$2,$3,$4,$5) AS id",[user,product,qty,version,crypto.randomUUID()])).rows[0].id;
  const a=await buy(one,pack,1,1),b=await buy(two,pack,2,2),c=await buy(buyer,goods,1,1),d=await buy(buyer,goods,1,2),cancelledPackage=await buy(buyer,pack,1,3);
  await db.query("SELECT shop_refund($1,$2,'test')",[d,admin]);
  await db.query("SELECT shop_refund($1,$2,'test')",[cancelledPackage,admin]);
  const cutoffResult=await db.query<{cutoff:string}>("SELECT (((now() AT TIME ZONE 'Asia/Seoul')::date-2)::timestamp AT TIME ZONE 'Asia/Seoul')::text AS cutoff");
  const due=cutoffResult.rows[0].cutoff;
  await db.query("UPDATE member_network SET activated_at=$1::timestamptz-interval '2 days' WHERE user_id=ANY($2::uuid[])",[due,[one,two,buyer]]);
  await db.query("UPDATE shop_orders SET created_at=$2::timestamptz-interval '1 day' WHERE id=ANY($1::uuid[])",[[a,b,c,d,cancelledPackage],due]);
  await db.query("UPDATE daily_pool_entries SET cutoff=$2 WHERE order_id=ANY($1::uuid[])",[[c,d],due]);
  const result=await db.query<{id:string}>("SELECT daily_pool_settle('lucky',$1) AS id",[due]);
  assert.equal((await db.query<{id:string}>("SELECT daily_pool_settle('lucky',$1) AS id",[due])).rows[0].id,result.rows[0].id);
  const payments=(await db.query<{user_id:string;amount:string}>("SELECT user_id,amount::text FROM daily_pool_payments WHERE run_id=$1 ORDER BY amount",[result.rows[0].id])).rows;
  assert.deepEqual(payments,[{user_id:one,amount:'2333333'},{user_id:two,amount:'4666666'}]);
  const run=(await db.query<{total:string;distributed:string;retained:string}>("SELECT total::text,distributed::text,retained::text FROM daily_pool_runs WHERE id=$1",[result.rows[0].id])).rows[0];
  assert.deepEqual(run,{total:'7000000',distributed:'6999999',retained:'1'});
  const treasure=await db.query<{id:string}>("SELECT daily_pool_settle('treasure',$1) AS id",[due]);
  assert.deepEqual((await db.query<{total:string;distributed:string;retained:string}>("SELECT total::text,distributed::text,retained::text FROM daily_pool_runs WHERE id=$1",[treasure.rows[0].id])).rows[0],{total:'5000000',distributed:'0',retained:'5000000'});
  await db.query("SELECT shop_refund($1,$2,'after distribution')",[c,admin]);
  assert.equal((await db.query<{n:string}>("SELECT sum(amount)::text AS n FROM daily_pool_payments WHERE run_id=$1",[result.rows[0].id])).rows[0].n,'6999999');
  // The same held package quantities participate again the next day, with no carryover of the first day's remainder.
  const nextDue=(await db.query<{cutoff:string}>("SELECT ($1::timestamptz+interval '1 day')::text AS cutoff",[due])).rows[0].cutoff;
  const newOrder=await buy(buyer,goods,1,5);
  await db.query("UPDATE shop_orders SET created_at=$2::timestamptz-interval '12 hours' WHERE id=$1",[newOrder,nextDue]);
  await db.query("UPDATE daily_pool_entries SET cutoff=$2 WHERE order_id=$1",[newOrder,nextDue]);
  const nextRun=(await db.query<{id:string}>("SELECT daily_pool_settle('lucky',$1) AS id",[nextDue])).rows[0].id;
  assert.deepEqual((await db.query<{user_id:string;amount:string}>("SELECT user_id,amount::text FROM daily_pool_payments WHERE run_id=$1 ORDER BY amount",[nextRun])).rows,[{user_id:one,amount:'2333333'},{user_id:two,amount:'4666666'}]);
  assert.equal((await db.query<{retained:string}>("SELECT retained::text FROM daily_pool_runs WHERE id=$1",[nextRun])).rows[0].retained,'1');
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM marketing_rewards WHERE type IN ('lucky','treasure')")).rows[0].n,0);
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM (SELECT batch_id,asset FROM journal GROUP BY batch_id,asset HAVING sum(units)<>0) q")).rows[0].n,0);
 } finally {await db.close();}
});
