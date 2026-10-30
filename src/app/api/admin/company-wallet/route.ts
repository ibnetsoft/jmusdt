import { api, identity, HttpError } from "@/lib/http";
import { sweepRuntime } from "@/lib/sweeps";
import { SweepChain } from "@/lib/sweep-chain";
import { validTronAddress } from "@/lib/tron";

// Read-only snapshot. An unavailable chain balance must never be treated as zero.
export async function GET() {
  return api(async () => {
    await identity(true);
    const config = sweepRuntime();
    if (!config.contract || !validTronAddress(config.contract) || !validTronAddress(config.company))
      throw new HttpError(503, "회사 지갑과 USDT 토큰 주소를 설정해 주세요.");
    const chain = new SweepChain();
    try {
      await chain.verifyToken();
      const [usdt, trx] = await Promise.all([chain.token(config.company), chain.trx(config.company)]);
      return { network: config.network, address: config.company, usdt: usdt.toString(), trx: trx.amount, checkedAt: new Date().toISOString() };
    } catch {
      throw new HttpError(503, "회사 지갑 잔액을 확인하지 못했습니다. 다시 조회해 주세요.");
    }
  });
}
