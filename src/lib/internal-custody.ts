import { HDNodeWallet } from "ethers";
import { TronWeb, type Types } from "tronweb";
import { database } from "./db";
import type { Pool } from "pg";
import { chainConfig } from "./tron";
import { companyWalletAddress } from "./company-wallet-address";
import { decryptTronKey } from "./tron-api-settings";
import { verifyCompanyWalletBackup } from "./company-transfers";
import { validateNative, validateTransfer, validateSigned, type NativeUnsigned, type Unsigned } from "./tron-transaction";

function active() { return process.env.INTERNAL_CUSTODY_ENABLED === "true"; }
async function masterPhrase(db: Pick<Pool,"query"> = database()) {
  if (!active() || chainConfig().network !== "mainnet") throw new Error("내부 서명 서비스가 준비되지 않았습니다.");
  const row=(await db.query("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1",["wu_member_wallet_mnemonic"])).rows[0];
  if(typeof row?.decrypted_secret!=="string" || !row.decrypted_secret) throw new Error("회원 지갑 서명 설정이 필요합니다.");
  return row.decrypted_secret as string;
}
export function deriveMemberKey(mnemonic:string,index:string) {
  if(!/^\d+$/.test(index)||BigInt(index)>2147483647n)throw new Error("잘못된 지갑 인덱스입니다.");
  return HDNodeWallet.fromPhrase(mnemonic,undefined,`m/44'/195'/0'/0/${index}`).privateKey.slice(2);
}
export async function assertInternalCustodyReady(db: Pick<Pool,"query"> = database()) {
  const phrase=await masterPhrase(db);
  await verifyCompanyWalletBackup(db);
  const row=(await db.query("SELECT address,derivation_index FROM deposit_addresses WHERE network=$1 AND address IS NOT NULL ORDER BY derivation_index LIMIT 1",[chainConfig().network])).rows[0];
  if(row && TronWeb.address.fromPrivateKey(deriveMemberKey(phrase,String(row.derivation_index)))!==row.address) throw new Error("기존 회원 지갑과 서명 설정이 일치하지 않습니다.");
}
export async function internalAddress(index:string,db: Pick<Pool,"query"> = database()) {
  const address=TronWeb.address.fromPrivateKey(deriveMemberKey(await masterPhrase(db),index));
  if(!address)throw new Error("입금 주소 생성 실패");
  return {address};
}
export async function internalSignSweep(kind:string,id:string,tx:Types.Transaction,db: Pool = database()) {
  if(!active()||chainConfig().network!=="mainnet"||!['sweep','sweep_gas'].includes(kind)||!/^[0-9a-f-]{36}$/i.test(id))throw new Error("서명 요청을 확인하세요.");
  const company=await companyWalletAddress(db), config=chainConfig(),phase=kind==='sweep_gas'?'gas':'token';
  const row=(await db.query(`SELECT j.*,a.address AS member_address,a.derivation_index AS current_index,o.txid AS stored_txid,o.payload AS stored_payload,o.amount AS transfer_amount,s.max_topup AS current_cap FROM sweep_jobs j JOIN deposit_addresses a ON a.user_id=j.user_id JOIN sweep_outbox o ON o.job_id=j.id JOIN sweep_settings s ON s.id=true WHERE j.id=$1 AND j.review_id IS NOT NULL AND j.status IN ('gas_funding','signing') AND s.enabled AND o.phase=$2 AND o.status IN ('prepared','signed')`,[id,phase])).rows[0];
  if(!row || row.network!==config.network || row.contract!==config.contract || row.destination!==company || row.source!==row.member_address || String(row.current_index)!==String(row.derivation_index) || tx.txID!==row.stored_txid || tx.raw_data_hex!==row.stored_payload.raw_data_hex || tx.raw_data.expiration<=Date.now() || Number(row.fee_limit)!==Number(process.env.TRON_FEE_LIMIT_SUN||100000000))throw new Error("승인된 회수 내역과 거래가 일치하지 않습니다.");
  let key:string;
  if(kind==='sweep_gas') {
    if(BigInt(row.transfer_amount)>BigInt(row.max_topup)||BigInt(row.transfer_amount)>BigInt(row.current_cap)||BigInt(row.transfer_amount)>100000000n)throw new Error("TRX 보충 한도를 초과합니다.");
    await verifyCompanyWalletBackup(db);
    const w=(await db.query("SELECT address,encrypted_private_key FROM company_wallets WHERE id=true")).rows[0];
    const secret=process.env.COMPANY_WALLET_ENCRYPTION_KEY;
    if(!w||!secret||w.address!==company)throw new Error("회사 서명 지갑을 확인하세요.");
    key=decryptTronKey(w.encrypted_private_key,secret);
    if(TronWeb.address.fromPrivateKey(key)!==company)throw new Error("회사 지갑 키가 일치하지 않습니다.");
    validateNative(tx as NativeUnsigned,{owner:company,to:row.source,amount:String(row.transfer_amount)});
  } else {
    key=deriveMemberKey(await masterPhrase(db),String(row.derivation_index));
    if(TronWeb.address.fromPrivateKey(key)!==row.source)throw new Error("회원 입금 주소가 일치하지 않습니다.");
    validateTransfer(tx as Unsigned,{owner:row.source,contract:row.contract,to:company,amount:String(row.amount),feeLimit:Number(row.fee_limit)});
  }
  const signed=await new TronWeb({fullHost:config.host}).trx.sign(tx,key);
  validateSigned(tx,signed);
  return signed;
}
