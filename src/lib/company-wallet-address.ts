import type { Pool, PoolClient } from "pg";
import { database } from "./db";
import { chainConfig, validTronAddress } from "./tron";

// A configured legacy address and the stored wallet must never silently diverge.
export async function companyWalletAddress(db: Pick<Pool | PoolClient, "query"> = database()): Promise<string> {
  const configured = (process.env.TRON_HOT_WALLET_ADDRESS || "").trim();
  const stored = (await db.query("SELECT address,network FROM company_wallets WHERE id=true")).rows[0] as {address:string;network:string}|undefined;
  if (stored && (stored.network !== chainConfig().network || !validTronAddress(stored.address))) throw new Error("회사 지갑의 네트워크 또는 주소가 올바르지 않습니다.");
  if (stored && configured && stored.address !== configured) throw new Error("회사 지갑 설정이 서로 다릅니다. 주소를 확인하세요.");
  return stored?.address || configured;
}
