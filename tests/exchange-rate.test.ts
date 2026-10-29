import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("exchange rate applies both directions, snapshots and rejects stale quotes", async () => {
 const db=new PGlite(), user=crypto.randomUUID();
 try {
  await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
  for(const file of ["schema.sql","commerce.sql","points.sql","exchange-rate.sql"]) await db.exec(await readFile(new URL(`../db/${file}`,import.meta.url),"utf8"));
  await db.query("INSERT INTO auth.users VALUES($1)",[user]);
  await db.query("INSERT INTO profiles(id,email,name) VALUES($1,'rate@example.com','Rate')",[user]);
  await db.query("INSERT INTO balances(user_id) VALUES($1)",[user]);
  await db.query("SELECT wallet_credit_deposit($1,10000000,'nile','rate-seed',0,100)",[user]);
  const key=crypto.randomUUID();
  const call=(way:string, amount:string, k:string, version:number)=>db.query<{id:string}>("SELECT wallet_swap($1,$2,$3,$4,$5) AS id",[user,way,amount,k,version]);
  const first=(await call('usdt_to_points','1000000',key,1)).rows[0];
  assert.deepEqual((await call('usdt_to_points','1000000',key,1)).rows[0],first);
  const record=(await db.query<{rate:number,target_amount:string}>("SELECT rate,target_amount FROM point_swaps WHERE id=$1",[first.id])).rows[0];
  assert.equal(record.rate,1300);assert.equal(String(record.target_amount),'1300000000');
  await call('points_to_usdt','1300000000',crypto.randomUUID(),1);
  assert.equal(String((await db.query<{available:string}>("SELECT available FROM balances WHERE user_id=$1",[user])).rows[0].available),'10000000');
  await db.query("UPDATE exchange_rate_settings SET rate=1400,version=2 WHERE id=true");
  await assert.rejects(call('usdt_to_points','1000000',crypto.randomUUID(),1),/RATE_CHANGED/);
  await call('usdt_to_points','1000000',crypto.randomUUID(),2);
  assert.equal(String((await db.query<{available:string}>("SELECT available FROM point_balances WHERE user_id=$1",[user])).rows[0].available),'1400000000');
  assert.deepEqual((await call('usdt_to_points','1000000',key,1)).rows[0],first);
  await call('points_to_usdt','1000000',crypto.randomUUID(),2);
  const last=(await db.query<{target_amount:string}>("SELECT target_amount FROM point_swaps WHERE direction='points_to_usdt' ORDER BY created_at DESC,id DESC LIMIT 1")).rows[0];
  assert.equal(String(last.target_amount),'714');
 } finally { await db.close(); }
});

