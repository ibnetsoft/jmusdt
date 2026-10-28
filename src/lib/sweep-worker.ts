import type { Pool } from "pg";
import type { Types } from "tronweb";
import { database } from "./db";
import { custody } from "./tron";
import { SweepChain, SweepError } from "./sweep-chain";
import { sweepRuntime, ACTIVE_SWEEPS } from "./sweeps";
import { ensureChainBinding } from "./chain-binding";
import {
  validateTransfer,
  validateNative,
  validateSigned,
  matchesTokenTransfer,
  type Unsigned,
  type NativeUnsigned,
} from "./tron-transaction";
export type SweepJob = {
  id: string;
  user_id: string;
  network: string;
  contract: string;
  source: string;
  destination: string;
  amount: string;
  max_topup: string;
  fee_limit: string;
  status: string;
  review_id: string;
  derivation_index: string;
};
type Outbox = {
  phase: "gas" | "token";
  txid: string;
  payload: Types.SignedTransaction;
  expiration: string;
  amount: string;
  status: string;
};
type Sign = (
  kind: "sweep" | "sweep_gas",
  id: string,
  tx: Types.Transaction,
) => Promise<Types.SignedTransaction>;
const signer: Sign = (kind, id, transaction) =>
  custody("/sign", { kind, id, transaction, network: sweepRuntime().network });
export async function advanceSweep(
  pool: Pool = database(),
  chain = new SweepChain(),
  sign: Sign = signer,
  now = Date.now(),
) {
  const c = sweepRuntime();
  await pool.query(
    "INSERT INTO sweep_worker_health(network,last_seen,last_error) VALUES($1,now(),'') ON CONFLICT(network) DO UPDATE SET last_seen=now(),last_error=''",
    [c.network],
  );
  if (c.issues.length) return { state: "unconfigured" };
  const client = await pool.connect();
  let job: SweepJob | undefined;
  try {
    await client.query("BEGIN");
    const locked = (
      await client.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",
        ["tron-outbound:" + c.network],
      )
    ).rows[0].locked;
    if (!locked) {
      await client.query("COMMIT");
      return { state: "busy" };
    }
    const settings = (
      await client.query("SELECT * FROM sweep_settings WHERE id=true FOR SHARE")
    ).rows[0];
    if (!settings.enabled) {
      await client.query("COMMIT");
      return { state: "paused" };
    }
    job = (
      await client.query<SweepJob>(
        "SELECT * FROM sweep_jobs WHERE network=$1 AND review_id IS NOT NULL AND status=ANY($2::text[]) ORDER BY created_at,id LIMIT 1 FOR UPDATE",
        [c.network, ACTIVE_SWEEPS],
      )
    ).rows[0];
    if (!job) {
      await client.query("COMMIT");
      return { state: "idle" };
    }
    if (
      job.contract !== c.contract ||
      job.destination !== c.company ||
      Number(job.fee_limit) !== c.feeLimit
    )
      throw new SweepError(
        "승인 이후 토큰·회사 주소·수수료 한도 변경: 기존 TX 조사 필요",
      );
    if (
      (
        await client.query("SELECT 1 FROM deposit_addresses WHERE address=$1", [
          c.company,
        ])
      ).rows.length
    )
      throw new SweepError("회사 주소가 회원 입금 주소로 등록되어 있습니다.");
    const address = (
      await client.query("SELECT * FROM deposit_addresses WHERE user_id=$1", [
        job.user_id,
      ])
    ).rows[0];
    if (
      !address ||
      address.address !== job.source ||
      address.network !== job.network ||
      String(address.derivation_index) !== String(job.derivation_index)
    )
      throw new SweepError("회원 주소 매핑 변경: 기존 TX 조사 필요");
    const boxes = (
      await client.query<Outbox>(
        "SELECT * FROM sweep_outbox WHERE job_id=$1 ORDER BY phase DESC FOR UPDATE",
        [job.id],
      )
    ).rows;
    const box =
      boxes.find((b) => b.phase === "token") ||
      boxes.find((b) => b.phase === "gas" && b.status !== "confirmed");
    const status = async (s: string, note: string) =>
      client.query(
        "UPDATE sweep_jobs SET status=$2,note=$3,updated_at=now() WHERE id=$1",
        [job!.id, s, note],
      );
    if (box) {
      if (box.phase === "gas")
        validateNative(box.payload as NativeUnsigned, {
          owner: c.company,
          to: job.source,
          amount: box.amount,
        });
      else
        validateTransfer(box.payload as Unsigned, {
          owner: job.source,
          contract: job.contract,
          to: c.company,
          amount: job.amount,
          feeLimit: Number(job.fee_limit),
        });
      if (box.payload.txID !== box.txid)
        throw new SweepError("저장된 TX ID 불일치");
      const receipt = await chain.receipt(box.txid);
      if (receipt.id) {
        if (
          receipt.id !== box.txid ||
          !Number.isSafeInteger(receipt.blockNumber) ||
          receipt.blockNumber! <= 0
        )
          throw new SweepError("확정 영수증 ID·블록 불일치");
        const failed =
          receipt.result === "FAILED" ||
          (receipt.receipt?.result && receipt.receipt.result !== "SUCCESS");
        if (failed) {
          await client.query(
            "UPDATE sweep_outbox SET status='failed',updated_at=now() WHERE job_id=$1 AND phase=$2",
            [job.id, box.phase],
          );
          await status(
            "failed",
            `${box.phase} TX 확정 실패: 새 검토가 필요합니다.`,
          );
        } else {
          if (box.phase === "token") {
            if (
              receipt.receipt?.result !== "SUCCESS" ||
              !matchesTokenTransfer(receipt.log, {
                contract: job.contract,
                source: job.source,
                target: c.company,
                amount: job.amount,
              })
            ) {
              await status(
                "needs_review",
                "성공 영수증의 정확한 USDT Transfer를 확인하지 못했습니다.",
              );
              await client.query("COMMIT");
              return { state: "needs_review" };
            }
          } else {
            const native = await chain.native(box.txid);
            validateNative(native, {
              owner: c.company,
              to: job.source,
              amount: box.amount,
            });
            if (
              native.txID !== box.txid ||
              native.raw_data_hex !== box.payload.raw_data_hex
            )
              throw new SweepError("TRX 보충 원본 TX 불일치");
          }
          await client.query(
            "UPDATE sweep_outbox SET status='confirmed',updated_at=now() WHERE job_id=$1 AND phase=$2",
            [job.id, box.phase],
          );
          await status(
            box.phase === "gas" ? "gas_confirmed" : "completed",
            box.phase === "gas"
              ? "TRX 보충 확정: USDT 이동 준비"
              : "USDT 회수 확정 완료",
          );
        }
        await client.query(
          "INSERT INTO audit_logs(action,details) VALUES('sweep.receipt',$1)",
          [
            JSON.stringify({
              id: job.id,
              phase: box.phase,
              txid: box.txid,
              failed: !!failed,
            }),
          ],
        );
        await client.query("COMMIT");
        return { state: failed ? "failed" : "confirmed" };
      }
      if (Number(box.expiration) <= now) {
        await client.query(
          "UPDATE sweep_outbox SET status='uncertain',updated_at=now() WHERE job_id=$1 AND phase=$2",
          [job.id, box.phase],
        );
        await status(
          "needs_review",
          "만료·미확정: 기존 TX만 계속 조회하며 새 서명·가스 보충을 만들지 않습니다.",
        );
        await client.query("COMMIT");
        return { state: "needs_review" };
      }
      if (!box.payload.signature) {
        const signed = await sign(
          box.phase === "gas" ? "sweep_gas" : "sweep",
          job.id,
          box.payload,
        );
        validateSigned(box.payload, signed);
        await client.query(
          "UPDATE sweep_outbox SET payload=$3,status='signed',updated_at=now() WHERE job_id=$1 AND phase=$2",
          [job.id, box.phase, JSON.stringify(signed)],
        );
        await status(
          box.phase === "gas" ? "gas_funding" : "signing",
          "서명 저장 완료: 동일 TX 전송 대기",
        );
        await client.query("COMMIT");
        return { state: "signed" };
      }
      validateSigned(box.payload, box.payload);
      if (box.phase === "gas") {
        if (
          BigInt(box.amount) > BigInt(settings.max_topup) ||
          BigInt(box.amount) > BigInt(job.max_topup)
        )
          throw new SweepError("현재 가스 보충 한도 초과: 전송 보류");
        if ((await chain.token(job.source)) < BigInt(job.amount))
          throw new SweepError("USDT 잔액 변경: TRX 보충 전송 보류");
        const company = await chain.trx(c.company);
        const fees = await chain.estimate(job.source, c.company, job.amount);
        if (
          BigInt(company.amount) <
          BigInt(settings.company_reserve) +
            BigInt(box.amount) +
            BigInt(fees.companyFee)
        )
          throw new SweepError("회사 TRX 최소 보유량 부족: 전송 보류");
      }
      await chain.broadcast(box.payload);
      await client.query(
        "UPDATE sweep_outbox SET status='broadcast',updated_at=now() WHERE job_id=$1 AND phase=$2",
        [job.id, box.phase],
      );
      await status(
        box.phase === "gas" ? "gas_funding" : "broadcast",
        "전송 접수: 확정 영수증 대기",
      );
      await client.query("COMMIT");
      return { state: "broadcast" };
    }
    if (job.status === "needs_review") {
      await client.query("COMMIT");
      return { state: "needs_review" };
    }
    await chain.verifyToken();
    const amount = await chain.token(job.source);
    if (amount < BigInt(job.amount)) {
      await status(
        "needs_review",
        "확정 USDT 잔액이 승인 수량보다 적습니다. 새 검토 필요",
      );
      await client.query("COMMIT");
      return { state: "needs_review" };
    }
    const estimate = await chain.estimate(job.source, c.company, job.amount),
      source = await chain.trx(job.source);
    if (BigInt(estimate.feeLimit) > BigInt(job.fee_limit))
      throw new SweepError("예상 비용이 승인된 수수료 한도를 초과합니다.");
    const topup =
      BigInt(estimate.required) > BigInt(source.amount)
        ? BigInt(estimate.required) - BigInt(source.amount)
        : 0n;
    let phase: "gas" | "token" = "token",
      quantity = job.amount,
      tx: Types.Transaction;
    if (topup > 0n) {
      if (boxes.some((b) => b.phase === "gas")) {
        await status(
          "needs_review",
          "가스 보충 후 자원이 부족합니다. 추가 보충은 자동 실행하지 않습니다.",
        );
        await client.query("COMMIT");
        return { state: "needs_review" };
      }
      if (topup > BigInt(job.max_topup) || topup > BigInt(settings.max_topup)) {
        await status(
          "needs_review",
          "현재 가스 보충 견적이 승인 상한을 초과합니다.",
        );
        await client.query("COMMIT");
        return { state: "needs_review" };
      }
      if (
        (
          await client.query(
            "SELECT 1 FROM transactions WHERE kind='withdrawal' AND status IN ('approved','signing','broadcast') LIMIT 1",
          )
        ).rows.length
      )
        throw new SweepError("회사 지갑 출금 처리 중: TRX 보충은 대기합니다.");
      const company = await chain.trx(c.company);
      if (
        BigInt(company.amount) <
        BigInt(settings.company_reserve) + topup + BigInt(estimate.companyFee)
      )
        throw new SweepError("회사 TRX 최소 보유량 부족");
      phase = "gas";
      quantity = topup.toString();
      tx = await chain.buildGas(c.company, job.source, quantity);
    } else {
      tx = await chain.buildToken(
        job.source,
        c.company,
        job.amount,
        Number(job.fee_limit),
      );
    }
    if (
      tx.raw_data.expiration <= now + 10000 ||
      tx.raw_data.expiration > now + 3600000
    )
      throw new SweepError("생성된 TX 유효기간 오류");
    await client.query(
      "INSERT INTO sweep_outbox(job_id,phase,txid,payload,expiration,amount) VALUES($1,$2,$3,$4,$5,$6)",
      [
        job.id,
        phase,
        tx.txID,
        JSON.stringify(tx),
        tx.raw_data.expiration,
        quantity,
      ],
    );
    await status(
      phase === "gas" ? "gas_funding" : "signing",
      "미서명 TX 저장 완료: 서명 대기",
    );
    await client.query("COMMIT");
    return { state: "prepared" };
  } catch (e) {
    await client.query("ROLLBACK");
    const message =
      e instanceof SweepError
        ? e.message
        : "회수 처리 오류: 서명·RPC·DB 상태 확인 필요";
    if (job)
      await pool.query(
        "UPDATE sweep_jobs SET note=$2,updated_at=now() WHERE id=$1",
        [job.id, message],
      );
    await pool.query(
      "UPDATE sweep_worker_health SET last_error=$2,last_seen=now() WHERE network=$1",
      [c.network, message],
    );
    return { state: "retry", error: message };
  } finally {
    client.release();
  }
}
export async function runSweepOnce() {
  await ensureChainBinding();
  return advanceSweep();
}
