import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

const migrations=["schema.sql","commerce.sql","points.sql","refunds.sql","organization.sql","marketing.sql","member-grades.sql","network-rollup.sql","daily-pools.sql"];
async function fixture() {
  const db=new PGlite();
  await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
  for(const file of migrations) await db.exec(await readFile(new URL("../db/"+file,import.meta.url),"utf8"));
  async function member(parent?:string,confirmed=true) {
    const id=crypto.randomUUID();
    const code=parent?(await db.query<{referral_code:string}>("SELECT referral_code FROM member_network WHERE user_id=$1",[parent])).rows[0].referral_code:undefined;
    await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data,email_confirmed_at) VALUES($1,$2,$3,CASE WHEN $4 THEN now() END)",[id,id+"@example.com",JSON.stringify({referral_code:code}),confirmed]);
    return id;
  }
  const qualify=async(id:string)=>{await db.query("UPDATE profiles SET grade_code='vip' WHERE id=$1",[id]);};
  return {db,member,qualify};
}

test("sponsorship follows regular qualification order through 3/6/9/12/15, waits without ancestors and never reallocates",async()=>{
  const {db,member,qualify}=await fixture();
  try {
    const chain:string[]=[];
    for(let i=0;i<6;i++) {const id=await member(chain.at(-1));chain.push(id);await qualify(id);}
    const signups:string[]=[];
    for(let i=0;i<18;i++) signups.push(await member(chain[5]));
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM member_network WHERE user_id=ANY($1::uuid[]) AND activated_at IS NOT NULL",[signups])).rows[0].n,0);
    const regulars=[...signups].reverse();
    for(const id of regulars) await qualify(id);
    for(let i=0;i<regulars.length;i++) {
      const row=(await db.query<{sponsor_id:string|null;referrer_id:string;referral_ordinal:string;rollup_generation:number;placement_reason:string}>("SELECT sponsor_id,referrer_id,referral_ordinal::text,rollup_generation,placement_reason FROM member_network WHERE user_id=$1",[regulars[i]])).rows[0];
      const ordinal=i+1,generation=ordinal%3===0?ordinal/3:0;
      assert.equal(row.referral_ordinal,String(ordinal));
      assert.equal(row.referrer_id,chain[5]);
      assert.equal(row.rollup_generation,generation);
      assert.equal(row.sponsor_id,chain[5-generation]??null);
      if(ordinal===18) assert.match(row.placement_reason,/상위 추천인 없음/);
    }
    const first=regulars[0];
    await db.query("SELECT network_activate($1)",[first]);
    await db.query("UPDATE profiles SET grade_code='general' WHERE id=$1",[first]);
    assert.equal((await db.query<{ok:boolean}>("SELECT member_reward_eligible($1) AS ok",[first])).rows[0].ok,false);
    await qualify(first);
    assert.equal((await db.query<{n:string}>("SELECT referral_ordinal::text AS n FROM member_network WHERE user_id=$1",[first])).rows[0].n,"1");
    await assert.rejects(db.query("SELECT network_place($1,$2,$1,'L')",[chain[5],first]),/AUTOMATIC_PLACEMENT_ONLY/);
    assert.equal((await db.query<{ok:boolean}>("SELECT has_function_privilege('authenticated','network_activate(uuid)','EXECUTE') AS ok")).rows[0].ok,false);
    // A general member can invite, but placement waits for that specific member's qualification.
    const general=await member(),child=await member(general);
    await qualify(child);
    assert.equal((await db.query<{sponsor_id:string|null}>("SELECT sponsor_id FROM member_network WHERE user_id=$1",[child])).rows[0].sponsor_id,null);
    await qualify(general);
    assert.equal((await db.query<{sponsor_id:string|null}>("SELECT sponsor_id FROM member_network WHERE user_id=$1",[child])).rows[0].sponsor_id,general);
    const unconfirmed=await member(general,false);await qualify(unconfirmed);
    assert.equal((await db.query<{activated_at:string|null}>("SELECT activated_at FROM member_network WHERE user_id=$1",[unconfirmed])).rows[0].activated_at,null);
    await db.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1",[unconfirmed]);
    assert.ok((await db.query<{activated_at:string|null}>("SELECT activated_at FROM member_network WHERE user_id=$1",[unconfirmed])).rows[0].activated_at);
    // Repeat the complete migration chain, preserving the assigned sequence.
    for(const file of migrations) await db.exec(await readFile(new URL("../db/"+file,import.meta.url),"utf8"));
    assert.equal((await db.query<{n:string}>("SELECT referral_ordinal::text AS n FROM member_network WHERE user_id=$1",[first])).rows[0].n,"1");
  } finally {await db.close();}
});

test("threshold purchase snapshots the rolled-up sponsor, pays direct POINT rewards immediately, and schedules only eligible daily dividends",async()=>{
  const {db,member,qualify}=await fixture();
  try {
    const great=await member();await qualify(great);
    const grand=await member(great);await qualify(grand);
    const parent=await member(grand);await qualify(parent);
    await qualify(await member(parent));await qualify(await member(parent));
    const buyer=await member(parent),product=crypto.randomUUID();
    const plan={referral:"2000000",sponsor:"3000000",mom:"3000000",daily:"1000000",days:2,lucky:5,treasure:7};
    await db.query("UPDATE marketing_settings SET enabled=true WHERE id=true");
    await db.query("INSERT INTO shop_products(id,name,price,stock,active,reward_plan) VALUES($1,'Qualification',50000000000,10,true,$2)",[product,JSON.stringify(plan)]);
    await db.query("INSERT INTO point_balances(user_id,available) VALUES($1,100000000000)",[buyer]);
    const order=(await db.query<{id:string}>("SELECT shop_purchase($1,$2,1,1,$3) AS id",[buyer,product,crypto.randomUUID()])).rows[0].id;
    assert.equal((await db.query<{grade_code:string}>("SELECT grade_code FROM profiles WHERE id=$1",[buyer])).rows[0].grade_code,"vip");
    const snapshot=(await db.query<{reward_snapshot:{referral:string;sponsor:string;mom:string}}>("SELECT reward_snapshot FROM shop_orders WHERE id=$1",[order])).rows[0].reward_snapshot;
    assert.equal(snapshot.referral,parent);assert.equal(snapshot.sponsor,grand);assert.equal(snapshot.mom,great);
    const direct=(await db.query<{type:string;user_id:string;status:string;asset:string;amount:string}>("SELECT r.type,r.user_id,r.status,t.asset,r.amount::text FROM marketing_rewards r JOIN transactions t ON t.id=r.transaction_id WHERE r.order_id=$1 ORDER BY r.type",[order])).rows;
    assert.deepEqual(direct,[{type:"mom",user_id:great,status:"paid",asset:"POINT",amount:"3000000"},{type:"referral",user_id:parent,status:"paid",asset:"POINT",amount:"2000000"},{type:"sponsor",user_id:grand,status:"paid",asset:"POINT",amount:"3000000"}]);
    const due=(await db.query<{cutoff:string;created_at:string}>("SELECT e.cutoff::text,o.created_at::text FROM daily_pool_entries e JOIN shop_orders o ON o.id=e.order_id WHERE o.id=$1 LIMIT 1",[order])).rows[0];
    assert.ok(new Date(due.cutoff)>new Date(due.created_at));
    assert.ok(new Date(due.cutoff).getTime()-new Date(due.created_at).getTime()<=24*60*60*1000);
    assert.equal(new Date(due.cutoff).getUTCHours(),15);
    assert.equal((await db.query<{n:number}>("SELECT marketing_run_daily() AS n")).rows[0].n,0);
    await db.query("UPDATE marketing_rewards SET due_date=(now() AT TIME ZONE 'Asia/Seoul')::date WHERE order_id=$1 AND type='daily'",[order]);
    await db.query("UPDATE profiles SET grade_code='general' WHERE id=$1",[buyer]);
    assert.equal((await db.query<{n:number}>("SELECT marketing_run_daily() AS n")).rows[0].n,0);
    await qualify(buyer);
    assert.equal((await db.query<{n:number}>("SELECT marketing_run_daily() AS n")).rows[0].n,2);
    assert.equal((await db.query<{n:number}>("SELECT marketing_run_daily() AS n")).rows[0].n,0);
    // Small purchases do not confer membership or daily payout rights.
    const general=await member(parent),small=crypto.randomUUID();
    await db.query("INSERT INTO shop_products(id,name,price,stock,active,reward_plan) VALUES($1,'Small',10000000000,10,true,$2)",[small,JSON.stringify(plan)]);
    await db.query("INSERT INTO point_balances(user_id,available) VALUES($1,10000000000)",[general]);
    const smallOrder=(await db.query<{id:string}>("SELECT shop_purchase($1,$2,1,1,$3) AS id",[general,small,crypto.randomUUID()])).rows[0].id;
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM marketing_rewards WHERE order_id=$1 AND user_id=$2",[smallOrder,general])).rows[0].n,0);
    assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM (SELECT batch_id,asset FROM journal GROUP BY batch_id,asset HAVING sum(units)<>0) q")).rows[0].n,0);
  } finally {await db.close();}
});
