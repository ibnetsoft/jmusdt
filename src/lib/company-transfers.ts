import { Wallet } from "ethers";
import { timingSafeEqual } from "node:crypto";
import { TronWeb, type Types } from "tronweb";
import type { Pool, PoolClient } from "pg";
import { database, transaction } from "./db";
import { chainConfig, validTronAddress } from "./tron";
import { encryptTronKey, decryptTronKey } from "./tron-api-settings";
import { SweepChain, SweepError } from "./sweep-chain";
import { validateTransfer, validateSigned, matchesTokenTransfer, type Unsigned } from "./tron-transaction";
import { parseUsdt } from "./money";

const active = ["approved", "signing", "broadcast", "needs_review"];
type WalletRow = { address: string; network: string; encrypted_private_key: string };
type Transfer = { id:string; actor:string; network:string; contract:string; source:string; destination:string; amount:string; fee_limit:string; status:string; expires_at:Date; txid:string|null; payload:Types.SignedTransaction|null };
function walletSecret() {
  const key=process.env.COMPANY_WALLET_ENCRYPTION_KEY;
  if(!key || key.length<32) throw new SweepError("회사 지갑 암호화 설정이 필요합니다.");
  return key;
}
export async function verifyCompanyWalletBackup(db: Pick<PoolClient,"query"> = database() as unknown as PoolClient) {
  const key=walletSecret();
  const value=(await db.query("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1",["wu_company_wallet_encryption"])).rows[0]?.decrypted_secret;
  const backup=Buffer.from(typeof value === "string" ? value : ""), configured=Buffer.from(key);
  if(backup.length!==configured.length || !timingSafeEqual(backup,configured)) throw new SweepError("회사 지갑 암호화 백업 설정을 확인하세요.");
}
function config() {
  const c=chainConfig();
  if (c.network!=="mainnet" || !c.contract) throw new SweepError("TRON 메인넷 설정을 확인하세요.");
  const limit=Number(process.env.TRON_FEE_LIMIT_SUN || "100000000");
  if (!Number.isSafeInteger(limit) || limit<=0 || limit>1000000000) throw new SweepError("수수료 한도 설정 오류");
  return {...c,contract:c.contract,feeLimit:limit};
}
async function wallet(db: Pick<PoolClient,"query">):Promise<WalletRow> {
  const row=(await db.query("SELECT address,network,encrypted_private_key FROM company_wallets WHERE id=true")).rows[0];
  if (!row) throw new SweepError("회사 지갑을 먼저 생성하세요.");
  return row;
}
export async function enableSweepAfterWalletCreation(db: Pick<PoolClient,"query">, address:string, actor:string) {
  if(process.env.SWEEP_ENABLE_ON_WALLET_CREATE !== "true") return false;
  const { sweepRuntime } = await import("./sweeps");
  const { assertInternalCustodyReady } = await import("./internal-custody");
  if(sweepRuntime(address).issues.length) return false;
  await assertInternalCustodyReady(db);
  const result=await db.query("UPDATE sweep_settings SET enabled=true,version=version+1,updated_at=now() WHERE id=true AND enabled=false RETURNING id");
  if(result.rowCount) await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'sweep.enabled_after_wallet_creation','{}'::jsonb)",[actor]);
  return true;
}
export async function createCompanyWallet(actor:string) {
  const c=config();
  return transaction(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('company-wallet-create',0))");
    const old=(await db.query("SELECT address FROM company_wallets WHERE id=true")).rows[0];
    if(old)return {address:old.address};
    if(process.env.TRON_HOT_WALLET_ADDRESS) throw new SweepError("기존 회사 지갑이 설정되어 있습니다. 새 지갑을 중복 생성할 수 없습니다.");
    const binding=(await db.query("INSERT INTO wallet_configuration(id,network,contract) VALUES(true,$1,$2) ON CONFLICT(id) DO UPDATE SET id=true RETURNING network,contract",[c.network,c.contract])).rows[0];
    if(binding.network!==c.network||binding.contract!==c.contract) throw new SweepError("기존 지갑 네트워크와 일치하지 않습니다.");
    await verifyCompanyWalletBackup(db);
    const key=Wallet.createRandom().privateKey.slice(2), address=TronWeb.address.fromPrivateKey(key);
    if(!address)throw new SweepError("회사 지갑 생성 실패");
    await db.query("INSERT INTO company_wallets(id,network,address,encrypted_private_key,created_by) VALUES(true,$1,$2,$3,$4)",[c.network,address,encryptTronKey(key,walletSecret()),actor]);
    await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'company.wallet_created',$2)",[actor,JSON.stringify({address,network:c.network})]);
    const sweepEnabled=await enableSweepAfterWalletCreation(db,address,actor);
    return {address,sweepEnabled};
  });
}
export async function companyWalletDashboard() {
  const db=database(), row=(await db.query("SELECT address,network FROM company_wallets WHERE id=true")).rows[0];
  const history=(await db.query("SELECT id,source,destination,amount::text,status,txid,note,created_at FROM company_transfers WHERE status<>'review' ORDER BY created_at DESC LIMIT 50")).rows;
  return { wallet:row || null,history };
}
export async function previewCompanyTransfer(actor:string,destination:string,quantity:string,chain=new SweepChain()) {
  const c=config();const target=destination.trim();
  if (!validTronAddress(target)) throw new SweepError("TRON 수신 주소를 확인하세요.");
  let amount:bigint;try{amount=parseUsdt(quantity);}catch{throw new SweepError("USDT 수량을 확인하세요.");}
  if(amount>9223372036854775807n)throw new SweepError("처리 가능한 수량을 초과했습니다.");
  const w=await wallet(database() as unknown as PoolClient);
  if(w.network!==c.network || w.address===target)throw new SweepError("회사 지갑과 다른 수신 주소를 입력하세요.");
  await chain.verifyToken();
  const balance=await chain.token(w.address), account=await chain.trx(w.address);
  if(!account.activated || balance<amount)throw new SweepError("회사 지갑 활성화 상태와 USDT 잔액을 확인하세요.");
  const estimate=await chain.estimate(w.address,target,amount.toString());
  if(BigInt(estimate.feeLimit)>BigInt(c.feeLimit) || BigInt(account.amount)<BigInt(estimate.required))throw new SweepError("회사 지갑의 TRX 잔액 또는 수수료 한도를 확인하세요.");
  const row=(await database().query("INSERT INTO company_transfers(actor,network,contract,source,destination,amount,fee_limit,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '5 minutes') RETURNING id,expires_at",[actor,c.network,c.contract,w.address,target,amount.toString(),c.feeLimit])).rows[0];
  return {id:row.id,source:w.address,destination:target,amount:amount.toString(),balance:balance.toString(),feeLimit:String(c.feeLimit),expiresAt:row.expires_at};
}
export async function approveCompanyTransfer(actor:string,id:string,reason:string) {
  const c=config();
  return transaction(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["tron-outbound:"+c.network]);
    const r=(await db.query<Transfer>("SELECT * FROM company_transfers WHERE id=$1 AND actor=$2 FOR UPDATE",[id,actor])).rows[0];
    if(!r)throw new SweepError("송금 검토 내역을 찾을 수 없습니다.");
    if(r.status!=="review")return {id:r.id,status:r.status};
    if(new Date(r.expires_at).getTime()<=Date.now())throw new SweepError("검토 시간이 만료되었습니다. 다시 검토하세요.");
    const w=await wallet(db);
    if(r.network!==c.network || r.contract!==c.contract || r.source!==w.address || Number(r.fee_limit)!==c.feeLimit)throw new SweepError("회사 지갑 설정이 변경되었습니다. 다시 검토하세요.");
    if((await db.query("SELECT 1 FROM company_transfers WHERE source=$1 AND status=ANY($2::text[])",[w.address,active])).rows.length)throw new SweepError("이전 송금이 진행 중입니다.");
    await db.query("UPDATE company_transfers SET status='approved',reason=$2,note='승인 완료',updated_at=now() WHERE id=$1",[id,reason]);
    await db.query("INSERT INTO audit_logs(actor,action,details) VALUES($1,'company.transfer_approved',$2)",[actor,JSON.stringify({id,destination:r.destination,amount:r.amount})]);
    return {id,status:"approved"};
  });
}
export async function advanceCompanyTransfer(chain=new SweepChain(), pool: Pool=database(), now=Date.now()) {
  const c=config(), db=await pool.connect();
  let row:Transfer|undefined;
  try {
    await db.query("BEGIN");
    const locked=(await db.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",["tron-outbound:"+c.network])).rows[0].locked;
    if(!locked){await db.query("COMMIT");return {state:"busy"};}
    row=(await db.query<Transfer>("SELECT * FROM company_transfers WHERE status=ANY($1::text[]) ORDER BY created_at LIMIT 1 FOR UPDATE",[active])).rows[0];
    if(!row){await db.query("COMMIT");return {state:"idle"};}
    const w=await wallet(db);
    const binding=(await db.query("SELECT network,contract FROM wallet_configuration WHERE id=true")).rows[0];
    if(!binding || binding.network!==c.network || binding.contract!==c.contract) throw new SweepError("기존 지갑 네트워크와 일치하지 않습니다.");
    if(row.network!==c.network||row.contract!==c.contract||row.source!==w.address||Number(row.fee_limit)!==c.feeLimit)throw new SweepError("회사 지갑 또는 네트워크가 변경되어 확인이 필요합니다.");
    const update=async(status:string,note:string)=>db.query("UPDATE company_transfers SET status=$2,note=$3,updated_at=now() WHERE id=$1",[row!.id,status,note]);
    if(row.payload && row.txid) {
      const payload=row.payload;
      validateTransfer(payload as Unsigned,{owner:row.source,contract:row.contract,to:row.destination,amount:row.amount,feeLimit:Number(row.fee_limit)});
      if(payload.txID!==row.txid)throw new SweepError("기록된 거래 ID가 일치하지 않습니다.");
      const receipt=await chain.receipt(row.txid);
      if(receipt.id){
        if(receipt.id!==row.txid || !receipt.blockNumber || receipt.blockNumber<=0)throw new SweepError("거래 영수증을 확인하세요.");
        if(receipt.result==='FAILED' || (receipt.receipt?.result && receipt.receipt.result!=='SUCCESS')) await update('failed','체인 전송 실패');
        else if(receipt.receipt?.result==='SUCCESS' && matchesTokenTransfer(receipt.log,{contract:row.contract,source:row.source,target:row.destination,amount:row.amount})) await update('completed','USDT 전송 확정');
        else await update('needs_review','전송 내역 확인 필요');
        await db.query("COMMIT");return {state:"receipt"};
      }
      if(payload.raw_data.expiration<=now){await update('needs_review','거래 만료 또는 미확정: 기존 거래 확인 필요');await db.query("COMMIT");return {state:'needs_review'};}
      if(!payload.signature){
        const key=decryptTronKey(w.encrypted_private_key,walletSecret());
        if(TronWeb.address.fromPrivateKey(key)!==w.address)throw new SweepError("회사 지갑 서명키가 일치하지 않습니다.");
        const signed=await chain.tron.trx.sign(payload,key);validateSigned(payload,signed);
        await db.query("UPDATE company_transfers SET payload=$2,status='signing',updated_at=now() WHERE id=$1",[row.id,JSON.stringify(signed)]);
        await db.query("COMMIT");return {state:'signed'};
      }
      validateSigned(payload,payload);
      await chain.broadcast(payload);
      await update('broadcast','전송 접수: 확정 대기');
      await db.query("COMMIT");return {state:'broadcast'};
    }
    if(row.status==='needs_review'){await db.query('COMMIT');return {state:'needs_review'};}
    await chain.verifyToken();const balance=await chain.token(row.source), trx=await chain.trx(row.source), fee=await chain.estimate(row.source,row.destination,row.amount);
    if(balance<BigInt(row.amount)||!trx.activated||BigInt(trx.amount)<BigInt(fee.required)||BigInt(fee.feeLimit)>BigInt(row.fee_limit)) throw new SweepError('잔액 또는 수수료를 다시 확인하세요.');
    const payload=await chain.buildToken(row.source,row.destination,row.amount,Number(row.fee_limit));
    if(payload.raw_data.expiration<=Date.now()+10000||payload.raw_data.expiration>Date.now()+3600000)throw new SweepError('거래 유효기간 오류');
    await db.query("UPDATE company_transfers SET txid=$2,payload=$3,status='signing',updated_at=now() WHERE id=$1",[row.id,payload.txID,JSON.stringify(payload)]);
    await db.query('COMMIT');return {state:'prepared'};
  } catch(e){await db.query('ROLLBACK');throw e;} finally{db.release();}
}
