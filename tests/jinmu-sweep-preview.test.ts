import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {TronWeb} from 'tronweb';
import {previewSweeps} from '../src/lib/sweeps';
import type {SweepChain} from '../src/lib/sweep-chain';

test('Jinmu preview caps the final source wallet at the remaining purchase amount',async()=>{
 const db=new PGlite(), actor=crypto.randomUUID(),users=[crypto.randomUUID(),crypto.randomUUID()];
 const company=TronWeb.address.fromPrivateKey('3'.padStart(64,'0')) as string;
 const sources=['1','2'].map(n=>TronWeb.address.fromPrivateKey(n.padStart(64,'0')) as string);
 const keys=['DATABASE_URL','TRON_NETWORK','SWEEP_REVIEW_SECRET','TRON_HOT_WALLET_ADDRESS'];const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const old=(globalThis as any).walletPool;
 try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
  for(const file of ['schema.sql','sweeps.sql']) await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
  await db.exec("ALTER TABLE transactions ADD COLUMN asset text NOT NULL DEFAULT 'USDT'; ALTER TABLE transactions DROP CONSTRAINT transactions_kind_check; ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK(kind IN ('deposit','transfer_in','transfer_out','withdrawal','jinmu_purchase')); CREATE TABLE company_wallets(id boolean primary key,network text,address text);");
  await db.exec(await readFile(new URL('../supabase/migrations/20261110000000_jinmu_sweeps.sql',import.meta.url),'utf8'));
  for(const id of [actor,...users]){await db.query('INSERT INTO auth.users VALUES($1)',[id]);await db.query("INSERT INTO profiles(id,email,name) VALUES($1,$2,'user')",[id,id+'@test.invalid']);}
  for(const [i,id] of users.entries()) await db.query("INSERT INTO deposit_addresses(user_id,network,address) VALUES($1,'mainnet',$2)",[id,sources[i]]);
  await db.query("INSERT INTO company_wallets VALUES(true,'mainnet',$1)",[company]);
  const query=async(sql:string,args:unknown[]=[])=>{const r=await db.query<any>(sql,args);return {...r,rowCount:r.rows.length}};
  (globalThis as any).walletPool={query};process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.TRON_NETWORK='mainnet';process.env.SWEEP_REVIEW_SECRET='x'.repeat(32);delete process.env.TRON_HOT_WALLET_ADDRESS;
  const chain={verifyToken:async()=>{},token:async(a:string)=>a===sources[0]?70n:90n,trx:async()=>({amount:'1000000000',activated:true}),estimate:async()=>({required:'0',feeLimit:'0',energy:'0',companyFee:'0'})} as unknown as SweepChain;
  const result=await previewSweeps(actor,users,chain,100n);
  assert.equal(result.purpose,'jinmu');assert.deepEqual(result.items.map(i=>i.amount),['70','30']);
  const row=(await db.query<any>('SELECT purpose,items FROM sweep_reviews WHERE id=$1',[result.id])).rows[0];assert.equal(row.purpose,'jinmu');assert.equal(row.items[1].amount,'30');
 } finally {(globalThis as any).walletPool=old;for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await db.close();}
});
