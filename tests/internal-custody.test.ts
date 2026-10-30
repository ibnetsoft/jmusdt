import { test } from "node:test";
import assert from "node:assert/strict";
import { TronWeb, Types, utils } from "tronweb";
import type { Pool } from "pg";
import { internalAddress, internalSignSweep } from "../src/lib/internal-custody";
import { encryptTronKey } from "../src/lib/tron-api-settings";
import { MAINNET_USDT } from "../src/lib/tron";
import { transferCalldata, validateSigned, type Unsigned, type NativeUnsigned } from "../src/lib/tron-transaction";

const phrase="test test test test test test test test test test test junk";
function seal<T extends Types.Transaction>(tx:T):T {const pb=utils.transaction.txJsonToPb(tx);tx.raw_data_hex=utils.transaction.txPbToRawDataHex(pb).toLowerCase();tx.txID=utils.transaction.txPbToTxID(pb).replace(/^0x/,"").toLowerCase();return tx;}
test("internal custody derives member addresses and signs only the persisted approved sweep",async()=>{
 const saved={...process.env};Object.assign(process.env,{INTERNAL_CUSTODY_ENABLED:'true',TRON_NETWORK:'mainnet',COMPANY_WALLET_ENCRYPTION_KEY:'test-only-company-secret-0123456789abcdef',TRON_FEE_LIMIT_SUN:'100000000'});delete process.env.TRON_HOT_WALLET_ADDRESS;
 const companyKey='2'.padStart(64,'0'),company=TronWeb.address.fromPrivateKey(companyKey) as string,id='12345678-1234-4234-8234-123456789abc';let row:any=null;
 const query=async(sql:string,params:any[]=[])=>{if(sql.includes('company_wallets'))return {rows:[{address:company,network:'mainnet',encrypted_private_key:encryptTronKey(companyKey,process.env.COMPANY_WALLET_ENCRYPTION_KEY)}]};if(sql.includes('vault.decrypted_secrets'))return {rows:[{decrypted_secret:params[0]==='wu_member_wallet_mnemonic'?phrase:process.env.COMPANY_WALLET_ENCRYPTION_KEY}]};if(sql.includes('sweep_jobs'))return {rows:row?[row]:[]};throw Error('Unexpected query')};const db={query} as unknown as Pool;
 try{
 const member=(await internalAddress('7',db)).address;assert.equal(member,(await internalAddress('7',db)).address);assert.notEqual(member,(await internalAddress('8',db)).address);await assert.rejects(internalAddress('-1',db));
 const base={timestamp:Date.now(),expiration:Date.now()+60000,ref_block_bytes:'abcd',ref_block_hash:'0123456789abcdef'};
 const token=seal<Unsigned>({visible:false,txID:'',raw_data_hex:'',raw_data:{...base,fee_limit:100000000,contract:[{type:Types.ContractType.TriggerSmartContract,parameter:{type_url:'type.googleapis.com/protocol.TriggerSmartContract',value:{owner_address:TronWeb.address.toHex(member),contract_address:TronWeb.address.toHex(MAINNET_USDT),data:transferCalldata(company,'1000000'),call_value:0}}}]}});
 row={network:'mainnet',contract:MAINNET_USDT,destination:company,source:member,member_address:member,current_index:'7',derivation_index:'7',stored_txid:token.txID,stored_payload:token,fee_limit:'100000000',amount:'1000000',transfer_amount:'1000000',max_topup:'10000000',current_cap:'10000000'};
 const signed=await internalSignSweep('sweep',id,token,db);validateSigned(token,signed);
 const altered=structuredClone(token);altered.txID='0'.repeat(64);await assert.rejects(internalSignSweep('sweep',id,altered,db));
 row=null;await assert.rejects(internalSignSweep('sweep',id,token,db));
 const gas=seal<NativeUnsigned>({visible:false,txID:'',raw_data_hex:'',raw_data:{...base,contract:[{type:Types.ContractType.TransferContract,parameter:{type_url:'type.googleapis.com/protocol.TransferContract',value:{owner_address:TronWeb.address.toHex(company),to_address:TronWeb.address.toHex(member),amount:5000000}}}]}});
 row={network:'mainnet',contract:MAINNET_USDT,destination:company,source:member,member_address:member,current_index:'7',derivation_index:'7',stored_txid:gas.txID,stored_payload:gas,fee_limit:'100000000',amount:'1000000',transfer_amount:'5000000',max_topup:'6000000',current_cap:'6000000'};
 validateSigned(gas,await internalSignSweep('sweep_gas',id,gas,db));row.current_cap='4000000';await assert.rejects(internalSignSweep('sweep_gas',id,gas,db),/한도/);
 }finally{for(const name of ['INTERNAL_CUSTODY_ENABLED','TRON_NETWORK','COMPANY_WALLET_ENCRYPTION_KEY','TRON_FEE_LIMIT_SUN','TRON_HOT_WALLET_ADDRESS']){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name]}}
});
