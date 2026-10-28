import { api, identity, HttpError } from "@/lib/http";
import { database } from "@/lib/db";
import { chainConfig, tronClient, validTronAddress } from "@/lib/tron";
export async function GET() {
  return api(async () => {
    await identity(true);
    const pool = database(),
      tron = tronClient(),
      { network, contract } = chainConfig();
    const hot = process.env.TRON_HOT_WALLET_ADDRESS;
    if (!contract || !hot || !validTronAddress(hot))
      throw new HttpError(503, "토큰과 핫월렛 주소를 설정해 주세요.");
    const [accounts, liability, fees, revenue, marketing] = await Promise.all([
      pool.query(
        "SELECT address FROM deposit_addresses WHERE network=$1 AND address IS NOT NULL",
        [network],
      ),
      pool.query(
        "SELECT ((SELECT COALESCE(sum(available+reserved),0) FROM balances)+(SELECT COALESCE(sum(available),0) FROM point_balances))::text AS units",
      ),
      pool.query(
        "SELECT COALESCE(sum(units),0)::text AS units FROM journal WHERE account='fees' AND asset='USDT'",
      ),
      pool.query(
        "SELECT COALESCE(sum(units),0)::text AS units FROM journal WHERE account='shop:revenue'",
      ),
      pool.query(
        "SELECT (SELECT coalesce(sum(units),0)::text FROM journal WHERE account='marketing:reserve' AND asset='POINT') AS reserve,(SELECT coalesce(sum(outstanding),0)::text FROM marketing_debts) AS debt",
      ),
    ]);
    if (accounts.rows.length > 500)
      throw new HttpError(
        503,
        "500개 이상의 주소는 별도 대사 워커로 조회해 주세요.",
      );
    const addresses = [
      ...new Set([hot, ...accounts.rows.map((row) => row.address as string)]),
    ];
    let onchain = 0n;
    for (const address of addresses) {
      const result =
        await tron.transactionBuilder.triggerConfirmedConstantContract(
          contract,
          "balanceOf(address)",
          {},
          [{ type: "address", value: address }],
          hot,
        );
      if (!result.constant_result?.[0])
        throw new HttpError(503, "체인 잔액 조회에 실패했습니다.");
      onchain += BigInt("0x" + result.constant_result[0]);
    }
    const [trx, resources] = await Promise.all([
      tron.trx.getBalance(hot),
      tron.trx.getAccountResources(hot),
    ]);
    const expected =
      BigInt(liability.rows[0].units) +
      BigInt(fees.rows[0].units) +
      BigInt(revenue.rows[0].units) +
      BigInt(marketing.rows[0].reserve) -
      BigInt(marketing.rows[0].debt);
    return {
      onchain: onchain.toString(),
      liability: liability.rows[0].units,
      fees: fees.rows[0].units,
      shopRevenue: revenue.rows[0].units,
      marketingReserve: marketing.rows[0].reserve,
      rewardDebt: marketing.rows[0].debt,
      difference: (onchain - expected).toString(),
      addresses: addresses.length,
      trx: String(trx),
      energy: Math.max(
        0,
        (resources.EnergyLimit || 0) - (resources.EnergyUsed || 0),
      ),
      bandwidth:
        Math.max(0, (resources.NetLimit || 0) - (resources.NetUsed || 0)) +
        Math.max(
          0,
          (resources.freeNetLimit || 0) - (resources.freeNetUsed || 0),
        ),
      checkedAt: new Date().toISOString(),
    };
  });
}
