import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { database, transaction } from "./db";
import { chainConfig, validTronAddress } from "./tron";
import { SweepChain, SweepError } from "./sweep-chain";
import { verifyExistingChainBinding } from "./chain-binding";
export const ACTIVE_SWEEPS = [
  "requested",
  "gas_funding",
  "gas_confirmed",
  "signing",
  "broadcast",
  "needs_review",
];
export function sweepRuntime() {
  const c = chainConfig(),
    company = process.env.TRON_HOT_WALLET_ADDRESS || "",
    issues: string[] = [];
  const feeLimit = Number(process.env.TRON_FEE_LIMIT_SUN || 100000000);
  if (!c.contract || !validTronAddress(c.contract))
    issues.push("USDT 토큰 주소 미설정");
  if (!validTronAddress(company)) issues.push("회사 지갑 주소 미설정");
  if (!Number.isSafeInteger(feeLimit) || feeLimit < 1 || feeLimit > 1000000000)
    issues.push("수수료 한도 설정 오류");
  if (!process.env.CUSTODY_URL || !process.env.CUSTODY_TOKEN)
    issues.push("격리 수탁·서명 서비스 미설정");
  if (process.env.TRON_BROADCAST_ENABLED !== "true")
    issues.push("서버 온체인 전송 비활성");
  if (
    (process.env.SWEEP_REVIEW_SECRET || process.env.CRON_SECRET || "").length <
    32
  )
    issues.push("검토 인증 비밀키(32자 이상) 미설정");
  return { ...c, company, feeLimit, issues };
}
export type SweepItem = {
  userId: string;
  source: string;
  index: string;
  amount: string;
  sourceTrx: string;
  topup: string;
  feeLimit: string;
  energy: string;
  required: string;
  companyFee: string;
};
export type ReviewRow = {
  id: string;
  actor: string;
  network: string;
  contract: string;
  company: string;
  settings_version: number;
  items: SweepItem[];
  expires_at: Date;
  approved_at: Date | null;
};
export function reviewToken(r: Pick<ReviewRow, "id" | "actor" | "expires_at">) {
  const key = process.env.SWEEP_REVIEW_SECRET || process.env.CRON_SECRET;
  if (!key || key.length < 32)
    throw new SweepError("검토 인증 비밀키(32자 이상)가 필요합니다.");
  return createHmac("sha256", key)
    .update(
      `jmusdt-sweep-v1:${r.id}:${r.actor}:${new Date(r.expires_at).toISOString()}`,
    )
    .digest("hex");
}
export function verifyReviewToken(
  r: Pick<ReviewRow, "id" | "actor" | "expires_at">,
  token: string,
) {
  const expected = Buffer.from(reviewToken(r)),
    provided = Buffer.from(token);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  )
    throw new SweepError("검토 인증이 올바르지 않습니다. 다시 검토하세요.");
}
export async function sweepDashboard(
  page: number,
  q: string,
  scan: boolean,
  historyPage: number,
  chain = new SweepChain(),
) {
  const c = sweepRuntime(),
    db = database();
  const [settings, rows, count, jobs, jobCount, health] = await Promise.all([
    db.query("SELECT * FROM sweep_settings WHERE id=true"),
    db.query(
      "SELECT a.user_id,a.address,a.derivation_index,p.email,p.name,p.status FROM deposit_addresses a JOIN profiles p ON p.id=a.user_id WHERE a.network=$1 AND a.address IS NOT NULL AND ($2='' OR p.email ILIKE '%'||$2||'%' OR p.name ILIKE '%'||$2||'%' OR a.address ILIKE '%'||$2||'%') ORDER BY a.user_id LIMIT 10 OFFSET $3",
      [c.network, q, (page - 1) * 10],
    ),
    db.query(
      "SELECT count(*)::int AS count FROM deposit_addresses a JOIN profiles p ON p.id=a.user_id WHERE a.network=$1 AND a.address IS NOT NULL AND ($2='' OR p.email ILIKE '%'||$2||'%' OR p.name ILIKE '%'||$2||'%' OR a.address ILIKE '%'||$2||'%')",
      [c.network, q],
    ),
    db.query(
      "SELECT j.id,j.user_id,p.email,j.status,j.network,j.source,j.destination,j.amount,j.max_topup,j.fee_limit,j.note,j.created_at,j.updated_at,j.review_id,j.txid AS legacy_txid,j.payload IS NOT NULL AS legacy_payload,g.txid AS gas_txid,g.status AS gas_status,t.txid AS token_txid,t.status AS token_status FROM sweep_jobs j JOIN profiles p ON p.id=j.user_id LEFT JOIN sweep_outbox g ON g.job_id=j.id AND g.phase='gas' LEFT JOIN sweep_outbox t ON t.job_id=j.id AND t.phase='token' ORDER BY j.created_at DESC,j.id LIMIT 50 OFFSET $1",
      [(historyPage - 1) * 50],
    ),
    db.query("SELECT count(*)::int AS count FROM sweep_jobs"),
    db.query(
      "SELECT last_seen,last_error FROM sweep_worker_health WHERE network=$1",
      [c.network],
    ),
  ]);
  let companyTrx: string | null = null,
    companyError = "";
  const wallets = rows.rows.map((r) => ({
    ...r,
    usdt: null as string | null,
    trx: null as string | null,
    error: scan ? "미확인" : "조회 전",
  }));
  if (scan && c.contract && validTronAddress(c.contract)) {
    const stop = Date.now() + 22000;
    try {
      await chain.verifyToken();
    } catch {
      for (const w of wallets) w.error = "토큰 검증 실패: 다시 조회하세요.";
      return {
        settings: settings.rows[0],
        config: c,
        wallets,
        count: count.rows[0].count,
        jobs: jobs.rows,
        jobCount: jobCount.rows[0].count,
        health: health.rows[0] || null,
        companyTrx,
        companyError: "토큰 검증 실패",
      };
    }
    if (validTronAddress(c.company))
      try {
        companyTrx = (await chain.trx(c.company)).amount;
      } catch {
        companyError = "회사 TRX 잔액 미확인";
      }
    for (const w of wallets) {
      if (Date.now() > stop) {
        w.error = "조회 시간 초과: 이 페이지를 다시 조회하세요.";
        continue;
      }
      try {
        w.usdt = (await chain.token(w.address)).toString();
        w.trx = (await chain.trx(w.address)).amount;
        w.error = "";
      } catch {
        w.error = "RPC 조회 실패: 0 잔액이 아닙니다.";
      }
    }
  }
  return {
    settings: settings.rows[0],
    config: c,
    wallets,
    count: count.rows[0].count,
    jobs: jobs.rows,
    jobCount: jobCount.rows[0].count,
    health: health.rows[0] || null,
    companyTrx,
    companyError,
  };
}
export async function previewSweeps(
  actor: string,
  userIds: string[],
  chain = new SweepChain(),
) {
  const c = sweepRuntime();
  if (!c.contract || !validTronAddress(c.company))
    throw new SweepError("USDT 토큰·회사 지갑 주소를 먼저 설정하세요.");
  await verifyExistingChainBinding();
  await chain.verifyToken();
  if (
    (
      await database().query(
        "SELECT 1 FROM deposit_addresses WHERE address=$1",
        [c.company],
      )
    ).rows.length
  )
    throw new SweepError("회사 지갑은 회원 입금 주소와 분리해야 합니다.");
  const s = (
    await database().query("SELECT * FROM sweep_settings WHERE id=true")
  ).rows[0];
  const company = await chain.trx(c.company);
  if (!company.activated)
    throw new SweepError("회사 TRON 주소 활성화 및 TRX 충전이 필요합니다.");
  const expires = new Date(Date.now() + 300000),
    items: SweepItem[] = [];
  let totalFunding = 0n,
    totalCompanyFees = 0n;
  for (const userId of userIds) {
    const a = (
      await database().query(
        "SELECT * FROM deposit_addresses WHERE user_id=$1 AND network=$2 AND address IS NOT NULL",
        [userId, c.network],
      )
    ).rows[0];
    if (!a || a.address === c.company)
      throw new SweepError(
        "등록된 회원 주소만 회수할 수 있습니다. 회사 주소는 제외하세요.",
      );
    if (
      (
        await database().query(
          "SELECT 1 FROM sweep_jobs WHERE user_id=$1 AND status=ANY($2::text[])",
          [userId, ACTIVE_SWEEPS],
        )
      ).rows.length
    )
      throw new SweepError("선택한 회원 지갑에 진행 중인 요청이 있습니다.");
    const amount = (await chain.token(a.address)).toString();
    if (BigInt(amount) === 0n)
      throw new SweepError("선택한 지갑의 확정 USDT 잔액이 0입니다.");
    if (BigInt(amount) > 9223372036854775807n)
      throw new SweepError("회수 수량이 지원 한도를 초과합니다.");
    const source = await chain.trx(a.address),
      estimate = await chain.estimate(a.address, c.company, amount);
    const topup =
      BigInt(estimate.required) > BigInt(source.amount)
        ? BigInt(estimate.required) - BigInt(source.amount)
        : 0n;
    if (topup > BigInt(s.max_topup))
      throw new SweepError(
        "필요 TRX 보충액이 건당 한도를 초과합니다. 자원을 확보하거나 한도를 검토하세요.",
      );
    if (BigInt(estimate.feeLimit) > BigInt(c.feeLimit))
      throw new SweepError("예상 에너지 비용이 서버 수수료 한도를 초과합니다.");
    totalFunding += topup;
    if (topup > 0n) totalCompanyFees += BigInt(estimate.companyFee);
    items.push({
      userId,
      source: a.address,
      index: String(a.derivation_index),
      amount,
      sourceTrx: source.amount,
      topup: topup.toString(),
      feeLimit: String(c.feeLimit),
      energy: estimate.energy,
      required: estimate.required,
      companyFee: estimate.companyFee,
    });
  }
  if (
    BigInt(company.amount) <
    BigInt(s.company_reserve) + totalFunding + totalCompanyFees
  )
    throw new SweepError(
      "회사 TRX가 일괄 보충액·수수료·최소 보유량을 충당하지 못합니다.",
    );
  const r = (
    await database().query<ReviewRow>(
      "INSERT INTO sweep_reviews(actor,network,contract,company,settings_version,items,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        actor,
        c.network,
        c.contract,
        c.company,
        s.version,
        JSON.stringify(items),
        expires,
      ],
    )
  ).rows[0];
  return {
    id: r.id,
    token: reviewToken(r),
    items,
    network: c.network,
    contract: c.contract,
    company: c.company,
    companyTrx: company.amount,
    reserve: s.company_reserve,
    totalFunding: totalFunding.toString(),
    expiresAt: expires.toISOString(),
    issues: c.issues,
    enabled: s.enabled,
  };
}
export async function approveSweeps(
  id: string,
  token: string,
  actor: string,
  reason: string,
) {
  return transaction(async (db) => {
    const r = (
      await db.query<ReviewRow>(
        "SELECT * FROM sweep_reviews WHERE id=$1 AND actor=$2",
        [id, actor],
      )
    ).rows[0];
    if (!r) throw new SweepError("본인이 검토한 요청만 승인할 수 있습니다.");
    verifyReviewToken(r, token);
    // Retry a committed approval even after its quote expired/config changed.
    if (r.approved_at)
      return {
        jobs: (
          await db.query("SELECT id FROM sweep_jobs WHERE review_id=$1", [id])
        ).rows.map((v) => v.id),
      };
    const c = sweepRuntime();
    if (c.issues.length) throw new SweepError(c.issues.join(" · "));
    if (
      r.network !== c.network ||
      r.contract !== c.contract ||
      r.company !== c.company
    )
      throw new SweepError(
        "네트워크·회사 주소가 변경됐습니다. 다시 검토하세요.",
      );
    return {
      jobs: (
        await db.query("SELECT approve_sweep_review($1,$2,$3) AS jobs", [
          id,
          actor,
          reason,
        ])
      ).rows[0].jobs,
    };
  });
}
export async function cancelSweep(
  db: PoolClient,
  id: string,
  actor: string,
  reason: string,
) {
  const result = await db.query(
    "UPDATE sweep_jobs j SET status='cancelled',note=$2,updated_at=now() WHERE id=$1 AND status IN ('requested','needs_review') AND payload IS NULL AND txid IS NULL AND NOT EXISTS(SELECT 1 FROM sweep_outbox WHERE job_id=j.id) RETURNING id",
    [id, reason],
  );
  if (!result.rows.length)
    throw new SweepError(
      "서명·전송을 시작하지 않은 대기 요청만 취소할 수 있습니다. 기존 TX를 확인하세요.",
    );
  await db.query(
    "INSERT INTO audit_logs(actor,action,details) VALUES($1,'sweep.cancelled',$2)",
    [actor, JSON.stringify({ id, reason })],
  );
  return { ok: true };
}
