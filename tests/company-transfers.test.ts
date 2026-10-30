import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { TronWeb, Types, utils } from 'tronweb';
import type { Pool } from 'pg';
import { SweepChain } from '../src/lib/sweep-chain';
import { MAINNET_USDT } from '../src/lib/tron';
import { encryptTronKey } from '../src/lib/tron-api-settings';
import { advanceCompanyTransfer } from '../src/lib/company-transfers';
import { TRANSFER_TOPIC, transferCalldata, type Unsigned } from '../src/lib/tron-transaction';

test('company transfer saves and reuses one transaction until the matching receipt is confirmed',async()=>{
 const previous={network:process.env.TRON_NETWORK,secret:process.env.COMPANY_WALLET_ENCRYPTION_KEY};process.env.TRON_NETWORK='mainnet';process.env.COMPANY_WALLET_ENCRYPTION_KEY='test-only-company-wallet-key-0123456789';
 const key='2'.padStart(64,'0'),from=TronWeb.address.fromPrivateKey(key) as string,to=TronWeb.address.fromPrivateKey('3'.padStart(64,'0')) as string, actor=crypto.randomUUID(), id=crypto.randomUUID();
 const db=new PGlite();const query=async(sql:string,params:unknown[]=[])=>db.query<any>(sql,params);const pool={query,connect:async()=>({query,release(){}})} as unknown as Pool;
 try{
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE TABLE profiles(id uuid primary key); CREATE TABLE wallet_configuration(id boolean primary key, network text, contract text);');
 await db.exec(await readFile(new URL('../supabase/migrations/20261030060612_company_wallet_transfers.sql',import.meta.url),'utf8'));
 await query("INSERT INTO wallet_configuration VALUES(true,'mainnet',$1)",[MAINNET_USDT]);await query('INSERT INTO profiles(id) VALUES($1)',[actor]);await query("INSERT INTO company_wallets(network,address,encrypted_private_key,created_by) VALUES('mainnet',$1,$2,$3)",[from,encryptTronKey(key,process.env.COMPANY_WALLET_ENCRYPTION_KEY),actor]);
 await query("INSERT INTO company_transfers(id,actor,network,contract,source,destination,amount,fee_limit,status,expires_at) VALUES($1,$2,'mainnet',$3,$4,$5,1000001,100000000,'approved',now()+interval '5 minutes')",[id,actor,MAINNET_USDT,from,to]);
 let receipt=false, broadcasts=0, txid='';
 class MockChain extends SweepChain {
  async verifyToken(){} async token(){return 3000000n;} async trx(){return {amount:'200000000',activated:true};}
  async estimate(){return {energy:'1',feeLimit:'100',required:'100',companyFee:'1'};}
  async buildToken(source:string,target:string,amount:string,feeLimit:number){const tx={visible:false,txID:'',raw_data_hex:'',raw_data:{timestamp:Date.now(),expiration:Date.now()+60000,ref_block_bytes:'abcd',ref_block_hash:'0123456789abcdef',fee_limit:feeLimit,contract:[{type:Types.ContractType.TriggerSmartContract,parameter:{type_url:'type.googleapis.com/protocol.TriggerSmartContract',value:{owner_address:TronWeb.address.toHex(source),contract_address:TronWeb.address.toHex(MAINNET_USDT),data:transferCalldata(target,amount),call_value:0}}}]}} as Unsigned;const pb=utils.transaction.txJsonToPb(tx);tx.raw_data_hex=utils.transaction.txPbToRawDataHex(pb).toLowerCase();tx.txID=utils.transaction.txPbToTxID(pb).replace(/^0x/,'').toLowerCase();txid=tx.txID;return tx;}
  async receipt(){return receipt?{id:txid,blockNumber:1,receipt:{result:'SUCCESS'},log:[{address:TronWeb.address.toHex(MAINNET_USDT).slice(2),topics:[TRANSFER_TOPIC,TronWeb.address.toHex(from).slice(2).padStart(64,'0'),TronWeb.address.toHex(to).slice(2).padStart(64,'0')],data:BigInt(1000001).toString(16).padStart(64,'0')}]}:{};}
  async broadcast(){broadcasts++;}
 }
 await assert.rejects(query("INSERT INTO company_transfers(actor,network,contract,source,destination,amount,fee_limit,status,expires_at) VALUES($1,'mainnet',$2,$3,$4,1,100000000,'approved',now()+interval '5 minutes')",[actor,MAINNET_USDT,from,to]));
 const chain=new MockChain();assert.equal((await advanceCompanyTransfer(chain,pool)).state,'prepared');assert.equal((await advanceCompanyTransfer(chain,pool)).state,'signed');assert.equal((await advanceCompanyTransfer(chain,pool)).state,'broadcast');assert.equal((await advanceCompanyTransfer(chain,pool)).state,'broadcast');assert.equal(broadcasts,2);const beforeExpiry=broadcasts;assert.equal((await advanceCompanyTransfer(chain,pool,Date.now()+120000)).state,'needs_review');assert.equal(broadcasts,beforeExpiry);receipt=true;await advanceCompanyTransfer(chain,pool);const row=(await query('SELECT status,txid FROM company_transfers WHERE id=$1',[id])).rows[0];assert.equal(row.status,'completed');assert.equal(row.txid,txid);assert.equal((await advanceCompanyTransfer(chain,pool)).state,'idle');
 }finally{await db.close();if(previous.network===undefined)delete process.env.TRON_NETWORK;else process.env.TRON_NETWORK=previous.network;if(previous.secret===undefined)delete process.env.COMPANY_WALLET_ENCRYPTION_KEY;else process.env.COMPANY_WALLET_ENCRYPTION_KEY=previous.secret;}
});
