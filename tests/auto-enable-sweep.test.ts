import { test } from "node:test";
import assert from "node:assert/strict";
import { TronWeb } from "tronweb";
import { enableSweepAfterWalletCreation } from "../src/lib/company-transfers";

test("requested auto activation runs only when wallet and custody are ready",async()=>{
 const names=['TRON_NETWORK','SWEEP_ENABLE_ON_WALLET_CREATE','INTERNAL_CUSTODY_ENABLED','SWEEP_BROADCAST_ENABLED','COMPANY_WALLET_ENCRYPTION_KEY','CRON_SECRET','CUSTODY_URL','CUSTODY_TOKEN'];const old=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 Object.assign(process.env,{TRON_NETWORK:'mainnet',SWEEP_ENABLE_ON_WALLET_CREATE:'true',INTERNAL_CUSTODY_ENABLED:'true',SWEEP_BROADCAST_ENABLED:'true',COMPANY_WALLET_ENCRYPTION_KEY:'test-company-wallet-key-0123456789abcdef',CRON_SECRET:'test-cron-secret-0123456789abcdef'});delete process.env.CUSTODY_URL;delete process.env.CUSTODY_TOKEN;
 const address=TronWeb.address.fromPrivateKey('2'.padStart(64,'0')) as string;let updated=false,audited=false;
 const db={query:async(sql:string,args?:any[])=>{if(sql.includes('vault.decrypted_secrets'))return {rows:[{decrypted_secret:args?.[0]==='wu_member_wallet_mnemonic'?'test test test test test test test test test test test junk':process.env.COMPANY_WALLET_ENCRYPTION_KEY}]};if(sql.includes('deposit_addresses'))return {rows:[]};if(sql.startsWith('UPDATE sweep_settings')){updated=true;return {rowCount:1,rows:[{id:true}]};}if(sql.includes('audit_logs')){audited=true;return {rows:[]};}throw Error('Unexpected query')}} as any;
 try{assert.equal(await enableSweepAfterWalletCreation(db,address,'actor'),true);assert.equal(updated,true);assert.equal(audited,true);process.env.SWEEP_ENABLE_ON_WALLET_CREATE='false';updated=false;assert.equal(await enableSweepAfterWalletCreation(db,address,'actor'),false);assert.equal(updated,false);}finally{for(const name of names){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name]}}
});
