import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Jinmu purchase records balanced revenue once without on-chain transfer', async()=>{
 const db=new PGlite(); const user=crypto.randomUUID(),key=crypto.randomUUID();
 const address='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
 try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
  await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
  await db.exec("ALTER TABLE transactions ADD COLUMN asset text NOT NULL DEFAULT 'USDT'; ALTER TABLE journal ADD COLUMN asset text NOT NULL DEFAULT 'USDT'; CREATE TABLE company_wallets(id boolean PRIMARY KEY DEFAULT true,network text NOT NULL,address text NOT NULL);");
  await db.exec(await readFile(new URL('../supabase/migrations/20261109000000_jinmu_purchase.sql',import.meta.url),'utf8'));
  await db.query('INSERT INTO auth.users VALUES($1)',[user]);
  await db.query("INSERT INTO profiles(id,email,name) VALUES($1,'buyer@example.test','buyer')",[user]);
  await db.query('INSERT INTO balances(user_id,available) VALUES($1,100000000)',[user]);
  await db.query("INSERT INTO company_wallets(id,network,address) VALUES(true,'mainnet',$1)",[address]);
  const pay=()=>db.query<any>('SELECT wallet_jinmu_purchase($1,$2,$3,$4,$5) AS id',[user,address,'mainnet',25000000,key]);
  const first=(await pay()).rows[0].id;
  assert.equal((await pay()).rows[0].id,first);
  assert.equal((await db.query<any>('SELECT available FROM balances WHERE user_id=$1',[user])).rows[0].available,75000000);
  assert.equal((await db.query<any>("SELECT sum(units)::text AS n FROM journal WHERE account='company:jinmu_sales'")).rows[0].n,'25000000');
  assert.equal((await db.query<any>('SELECT sum(units)::text AS n FROM journal WHERE transaction_id=$1',[first])).rows[0].n,'0');
  assert.equal((await db.query<any>('SELECT kind,asset,status,txid FROM transactions WHERE id=$1',[first])).rows[0].kind,'jinmu_purchase');
  await assert.rejects(db.query('SELECT wallet_jinmu_purchase($1,$2,$3,$4,$5)',[user,address,'mainnet',24000000,key]),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(db.query('SELECT wallet_jinmu_purchase($1,$2,$3,$4,$5)',[user,'wrong-address','mainnet',1,crypto.randomUUID()]),/COMPANY_ADDRESS_CHANGED/);
  await assert.rejects(db.query('SELECT wallet_jinmu_purchase($1,$2,$3,$4,$5)',[user,address,'mainnet',100000000,crypto.randomUUID()]),/INSUFFICIENT_BALANCE/);
  assert.equal((await db.query<any>('SELECT available FROM balances WHERE user_id=$1',[user])).rows[0].available,75000000);
  const perms=await db.query<any>("SELECT has_function_privilege('authenticated','wallet_jinmu_purchase(uuid,text,text,bigint,uuid)','EXECUTE') AS allowed");
  assert.equal(perms.rows[0].allowed,false);
 } finally {await db.close()}
});
