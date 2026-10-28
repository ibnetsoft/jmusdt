import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Regular membership promotion uses own POINT purchases and retains manual grades", async()=>{
 const db=new PGlite();
 const buyer=crypto.randomUUID(),custom=crypto.randomUUID(),admin=crypto.randomUUID(),product=crypto.randomUUID();
 try {
  await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
  for(const file of ["schema.sql","commerce.sql","points.sql","refunds.sql","organization.sql","marketing.sql","member-grades.sql"]) await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
  for(const id of [buyer,custom,admin]) await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[id,id+"@example.com"]);
  await db.query("INSERT INTO member_grades(code,name) VALUES('special','특별회원')");
  await db.query("UPDATE profiles SET grade_code='special' WHERE id=$1",[custom]);
  await db.query("UPDATE marketing_settings SET enabled=false WHERE id=true");
  const plan={referral:"0",sponsor:"0",mom:"0",daily:"0",days:0,lucky:2,treasure:3};
  await db.query("INSERT INTO shop_products(id,name,price,stock,active,reward_plan) VALUES($1,'test',25000000000,10,true,$2)",[product,JSON.stringify(plan)]);
  for(const id of [buyer,custom]) {await db.query("INSERT INTO point_balances(user_id,available) VALUES($1,100000000000)",[id]);}
  const buy=async(id:string,qty:number,version:number)=> (await db.query<{id:string}>("SELECT shop_purchase($1,$2,$3,$4,$5) AS id",[id,product,qty,version,crypto.randomUUID()])).rows[0].id;
  const order=await buy(buyer,1,1);
  assert.equal((await db.query<{grade_code:string}>("SELECT grade_code FROM profiles WHERE id=$1",[buyer])).rows[0].grade_code,'general');
  await buy(buyer,1,2);
  assert.equal((await db.query<{grade_code:string}>("SELECT grade_code FROM profiles WHERE id=$1",[buyer])).rows[0].grade_code,'vip');
  await buy(custom,2,3);
  assert.equal((await db.query<{grade_code:string}>("SELECT grade_code FROM profiles WHERE id=$1",[custom])).rows[0].grade_code,'special');
  await db.query("SELECT shop_refund($1,$2,'test')",[order,admin]);
  assert.equal((await db.query<{grade_code:string}>("SELECT grade_code FROM profiles WHERE id=$1",[buyer])).rows[0].grade_code,'vip');
  assert.equal((await db.query<{allowed:boolean}>("SELECT has_table_privilege('authenticated','member_grades','INSERT') AS allowed")).rows[0].allowed,false);
 } finally {await db.close();}
});
