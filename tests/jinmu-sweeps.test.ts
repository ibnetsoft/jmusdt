import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('general and Jinmu collections reserve purchase funds once and release only failed or cancelled jobs', async()=>{
 const db=new PGlite();const actor=crypto.randomUUID(), users=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
 try{
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
  for(const file of ['schema.sql','sweeps.sql']) await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
  await db.exec("ALTER TABLE transactions ADD COLUMN asset text NOT NULL DEFAULT 'USDT'; ALTER TABLE transactions DROP CONSTRAINT transactions_kind_check; ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK(kind IN ('deposit','transfer_in','transfer_out','withdrawal','jinmu_purchase'));");
  await db.exec(await readFile(new URL('../supabase/migrations/20261110000000_jinmu_sweeps.sql',import.meta.url),'utf8'));
  for (const id of [actor,...users]){await db.query('INSERT INTO auth.users VALUES($1)',[id]);await db.query("INSERT INTO profiles(id,email,name) VALUES($1,$2,'user')",[id,id+'@test.invalid']);}
  await db.query("INSERT INTO transactions(user_id,kind,amount,status,asset) VALUES($1,'jinmu_purchase',100,'completed','USDT')",[actor]);
  await db.query('UPDATE sweep_settings SET enabled=true');
  for(const [n,user] of users.entries()) await db.query("INSERT INTO deposit_addresses(user_id,network,address) VALUES($1,'mainnet',$2)",[user,'address-'+n]);
  const review=async(n:number,amount:number,purpose:string)=>{
   const user=users[n],row=(await db.query<any>('SELECT derivation_index,address FROM deposit_addresses WHERE user_id=$1',[user])).rows[0];
   const items=[{userId:user,source:row.address,index:String(row.derivation_index),amount:String(amount),topup:'0',feeLimit:'100000000'}];
   return (await db.query<any>("INSERT INTO sweep_reviews(actor,network,contract,company,settings_version,items,purpose) VALUES($1,'mainnet','contract','company',1,$2,$3) RETURNING id",[actor,JSON.stringify(items),purpose])).rows[0].id;
  };
  const approve=async(id:string)=>(await db.query<any>("SELECT approve_sweep_review($1,$2,'approved') AS jobs",[id,actor])).rows[0].jobs[0];
  const general=await review(0,70,'general'),job1=await approve(general);
  assert.equal((await db.query<any>('SELECT jinmu_amount,purpose FROM sweep_jobs WHERE id=$1',[job1])).rows[0].jinmu_amount,70);
  const tooMuch=await review(1,31,'jinmu');await assert.rejects(approve(tooMuch),/SWEEP_JINMU_AMOUNT_CHANGED/);
  const exact=await review(1,30,'jinmu'),job2=await approve(exact);assert.equal(await approve(exact),job2);
  assert.equal((await db.query<any>('SELECT jinmu_amount FROM sweep_jobs WHERE id=$1',[job2])).rows[0].jinmu_amount,30);
  const blocked=await review(2,1,'jinmu');await assert.rejects(approve(blocked),/SWEEP_JINMU_AMOUNT_CHANGED/);
  await db.query("UPDATE sweep_jobs SET status='failed' WHERE id=$1",[job1]);
  const retry=await review(2,70,'jinmu'),job3=await approve(retry);
  assert.equal((await db.query<any>('SELECT jinmu_amount FROM sweep_jobs WHERE id=$1',[job3])).rows[0].jinmu_amount,70);
  await db.query("UPDATE sweep_jobs SET status='completed' WHERE id=$1",[job2]);
  await db.query("UPDATE sweep_jobs SET status='needs_review' WHERE id=$1",[job3]);
  const extra=await review(0,1,'jinmu');await assert.rejects(approve(extra),/SWEEP_JINMU_AMOUNT_CHANGED/);
  const privileges=(await db.query<any>("SELECT has_function_privilege('authenticated','approve_sweep_review(uuid,uuid,text)','EXECUTE') AS allowed")).rows[0];assert.equal(privileges.allowed,false);
 }finally{await db.close()}
});
test('migration refuses to guess allocation for overlapping historical sweeps',async()=>{
 const db=new PGlite(),user=crypto.randomUUID();
 try{
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';");
  for(const file of ['schema.sql','sweeps.sql']) await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
  await db.exec("ALTER TABLE transactions ADD COLUMN asset text NOT NULL DEFAULT 'USDT'; ALTER TABLE transactions DROP CONSTRAINT transactions_kind_check; ALTER TABLE transactions ADD CONSTRAINT transactions_kind_check CHECK(kind IN ('deposit','transfer_in','transfer_out','withdrawal','jinmu_purchase'));");
  await db.query('INSERT INTO auth.users VALUES($1)',[user]);await db.query("INSERT INTO profiles(id,email,name) VALUES($1,'user@test.invalid','user')",[user]);
  await db.query("INSERT INTO transactions(user_id,kind,amount,status) VALUES($1,'jinmu_purchase',10,'completed')",[user]);
  await db.query("INSERT INTO sweep_jobs(user_id,status) VALUES($1,'completed')",[user]);
  await assert.rejects(db.exec(await readFile(new URL('../supabase/migrations/20261110000000_jinmu_sweeps.sql',import.meta.url),'utf8')),/manual attribution/);
 }finally{await db.close()}
});
