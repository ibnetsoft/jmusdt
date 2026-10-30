import { companyWalletAddress } from "./company-wallet-address";
import { database, transaction } from "./db";
import { parseUsdt } from "./money";
import { chainConfig, custody, validTronAddress } from "./tron";
import { HttpError } from "./http";
import { ensureChainBinding } from "./chain-binding";
import { initializeDepositCursor } from "./deposit-monitor";
export function feeUnits() {
  const value = process.env.WITHDRAWAL_FEE_USDT || "1";
  return value === "0" ? 0n : parseUsdt(value);
}
export async function walletSnapshot(profile: {
  id: string;
  email: string;
  name: string;
  status: string;
}) {
  const pool = database();
  const [balance, addresses, history, packages, grade] = await Promise.all([
    pool.query(
      "SELECT b.*,coalesce(p.available,0)::text AS points FROM balances b LEFT JOIN point_balances p ON p.user_id=b.user_id WHERE b.user_id=$1",
      [profile.id],
    ),
    pool.query(
      "SELECT address,network FROM deposit_addresses WHERE user_id=$1",
      [profile.id],
    ),
    pool.query(
      "SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC",
      [profile.id],
    ),
    pool.query("SELECT package_type,sum(quantity)::text AS quantity FROM shop_orders WHERE user_id=$1 AND package_type IN ('lucky','treasure') AND status IN ('paid','cancellation_requested') GROUP BY package_type", [profile.id]),
    pool.query("SELECT g.name,n.referral_code FROM profiles p JOIN member_grades g ON g.code=p.grade_code LEFT JOIN member_network n ON n.user_id=p.id WHERE p.id=$1",[profile.id]),
  ]);
  const config = chainConfig();
  const address = addresses.rows[0];
  if (address && address.network !== config.network)
    throw new HttpError(503, "지갑 네트워크 설정이 일치하지 않습니다.");
  return {
    mode: "live",
    user: { ...profile, gradeName: grade.rows[0]?.name || "일반회원" },
    referralCode: grade.rows[0]?.referral_code || "",
    available: balance.rows[0]?.available || "0",
    points: balance.rows[0]?.points || "0",
    packages: { lucky: packages.rows.find((p) => p.package_type === "lucky")?.quantity || "0", treasure: packages.rows.find((p) => p.package_type === "treasure")?.quantity || "0" },
    reserved: balance.rows[0]?.reserved || "0",
    address: address?.address || null,
    network: config.network,
    fee: feeUnits().toString(),
    minimum: parseUsdt(process.env.MIN_WITHDRAWAL_USDT || "10").toString(),
    transactions: history.rows,
  };
}
export async function provisionAddress(userId: string) {
  await initializeDepositCursor();
  const { network } = chainConfig();
  const entry = await database().query(
    `INSERT INTO deposit_addresses(user_id,network) VALUES($1,$2)
    ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING *`,
    [userId, network],
  );
  const row = entry.rows[0];
  if (row.network !== network)
    throw new HttpError(409, "기존 주소의 네트워크가 다릅니다.");
  if (row.address) return row.address;
  const response = await custody<{ address: string }>("/addresses", {
    network,
    index: String(row.derivation_index),
    idempotencyKey: `address:${network}:${userId}`,
  });
  if (!validTronAddress(response.address))
    throw new HttpError(503, "잘못된 입금 주소 응답입니다.");
  const result = await database().query(
    "UPDATE deposit_addresses SET address=COALESCE(address,$2) WHERE user_id=$1 RETURNING address",
    [userId, response.address],
  );
  return result.rows[0].address;
}
export async function requestTransfer(
  userId: string,
  recipient: string,
  amount: string,
  key: string,
) {
  const units = parseUsdt(amount);
  const result = await database().query(
    "SELECT wallet_transfer($1,$2,$3,$4) AS id",
    [userId, recipient, units.toString(), key],
  );
  return result.rows[0];
}
export async function requestWithdrawal(
  userId: string,
  address: string,
  amount: string,
  key: string,
) {
  await ensureChainBinding();
  if (!validTronAddress(address))
    throw new HttpError(400, "올바른 TRON 주소를 입력해 주세요.");
  const units = parseUsdt(amount);
  if (units < parseUsdt(process.env.MIN_WITHDRAWAL_USDT || "10"))
    throw new HttpError(400, "최소 출금 금액보다 작습니다.");
  const owned = await database().query(
    "SELECT 1 FROM deposit_addresses WHERE address=$1",
    [address],
  );
  if (address === chainConfig().contract)
    throw new HttpError(400, "토큰 컨트랙트 주소로 출금할 수 없습니다.");
  if (owned.rowCount || address === await companyWalletAddress())
    throw new HttpError(400, "서비스 내부 주소에는 회원 송금을 이용해 주세요.");
  const result = await database().query(
    "SELECT wallet_request_withdrawal($1,$2,$3,$4,$5) AS id",
    [userId, address, units.toString(), feeUnits().toString(), key],
  );
  return result.rows[0];
}
export async function adminSnapshot() {
  const pool = database();
  const [users, withdrawals, history, audit, cursor, hotAddress] = await Promise.all([
    pool.query(
      "SELECT p.*,b.available,b.reserved FROM profiles p JOIN balances b ON b.user_id=p.id ORDER BY p.created_at DESC LIMIT 500",
    ),
    pool.query(
      "SELECT t.*,p.email,s.last_error FROM transactions t JOIN profiles p ON p.id=t.user_id LEFT JOIN signed_transactions s ON s.transaction_id=t.id WHERE kind='withdrawal' ORDER BY t.created_at DESC LIMIT 200",
    ),
    pool.query(
      "SELECT t.*,p.email FROM transactions t JOIN profiles p ON p.id=t.user_id ORDER BY t.created_at DESC LIMIT 200",
    ),
    pool.query(
      "SELECT a.*,COALESCE(p.email,'worker') AS actor FROM audit_logs a LEFT JOIN profiles p ON p.id=a.actor ORDER BY a.created_at DESC LIMIT 100",
    ),
    pool.query("SELECT * FROM chain_cursor WHERE network=$1", [
      chainConfig().network,
    ]),
    companyWalletAddress(pool),
  ]);
  return {
    mode: "live",
    users: users.rows,
    withdrawals: withdrawals.rows.map((row) => ({
      ...row,
      note: row.last_error || row.note,
    })),
    transactions: history.rows,
    audit: audit.rows,
    operations: {
      cursor: cursor.rows[0]?.block_number || null,
      updated_at: cursor.rows[0]?.updated_at || null,
      hotAddress: hotAddress || null,
      network: chainConfig().network,
      broadcast: process.env.TRON_BROADCAST_ENABLED === "true",
    },
  };
}
export async function changeUserStatus(
  userId: string,
  actor: string,
  status: string,
) {
  if (userId === actor)
    throw new HttpError(400, "자신의 계정은 차단할 수 없습니다.");
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(9692027)");
    const row = await client.query(
      "UPDATE profiles SET status=$2 WHERE id=$1 RETURNING id",
      [userId, status],
    );
    if (!row.rowCount) throw new HttpError(404, "회원이 없습니다.");
    await client.query(
      "INSERT INTO audit_logs(actor,action,details) VALUES($1,$2,$3)",
      [actor, "member." + status, JSON.stringify({ user_id: userId })],
    );
  });
}
