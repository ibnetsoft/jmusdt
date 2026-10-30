import { setTimeout as delay } from "node:timers/promises";
import { TronWeb, type Types } from "tronweb";
import { getTronGridKey } from "./tron-api-settings";
import { chainConfig, validTronAddress } from "./tron";
import {
  transferCalldata,
  validateTransfer,
  validateNative,
  matchesTokenTransfer,
  type Receipt,
  type Unsigned,
  type NativeUnsigned,
} from "./tron-transaction";
export class SweepError extends Error {}
export function unsignedInt(v: unknown, name: string): bigint {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    throw new SweepError(name + " 조회값이 올바르지 않습니다.");
  return BigInt(v);
}
export function gasBudget(
  energy: bigint,
  available: bigint,
  price: bigint,
  bandwidthPrice: bigint,
) {
  const buffered = (energy * 13n + 9n) / 10n;
  return {
    energy: buffered.toString(),
    feeLimit: (buffered * price).toString(),
    required: (
      (buffered > available ? buffered - available : 0n) * price +
      1000n * bandwidthPrice
    ).toString(),
  };
}
export class SweepChain {
  config = chainConfig();
  tron = new TronWeb({ fullHost: this.config.host });
  private tail: Promise<unknown> = Promise.resolve();
  private last = 0;
  rpc<T>(method: string, body: unknown): Promise<T> {
    const run = this.tail
      .catch(() => {})
      .then(async () => {
        const apiKey = await getTronGridKey();
        await delay(
          Math.max(
            0,
            (apiKey ? 150 : 1100) -
              (Date.now() - this.last),
          ),
        );
        this.last = Date.now();
        const r = await fetch(`${this.config.host}/${method}`, {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
          headers: {
            "Content-Type": "application/json",
            ...(apiKey
              ? { "TRON-PRO-API-KEY": apiKey }
              : {}),
          },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new SweepError(`TRON 조회 실패 (HTTP ${r.status})`);
        const value = await r.json();
        if (value.Error || value.error) throw new SweepError("TRON RPC 오류");
        return value as T;
      });
    this.tail = run;
    return run;
  }
  async token(address: string) {
    if (!this.config.contract || !validTronAddress(address))
      throw new SweepError("토큰·주소 설정이 필요합니다.");
    const r = await this.rpc<{
      result?: { result?: boolean };
      constant_result?: string[];
    }>("walletsolidity/triggerconstantcontract", {
      owner_address: address,
      contract_address: this.config.contract,
      function_selector: "balanceOf(address)",
      parameter: TronWeb.address.toHex(address).slice(2).padStart(64, "0"),
      visible: true,
    });
    if (
      !r.result?.result ||
      !/^[0-9a-f]{64}$/i.test(r.constant_result?.[0] || "")
    )
      throw new SweepError("USDT 확정 잔액 미확인");
    return BigInt("0x" + r.constant_result![0]);
  }
  async trx(address: string) {
    const r = await this.rpc<{ address?: string; balance?: number }>(
      "wallet/getaccount",
      { address, visible: true },
    );
    return {
      amount: unsignedInt(r.balance ?? 0, "TRX").toString(),
      activated: !!r.address,
    };
  }
  async verifyToken() {
    const r = await this.rpc<{
      result?: { result?: boolean };
      constant_result?: string[];
    }>("walletsolidity/triggerconstantcontract", {
      owner_address: this.config.contract,
      contract_address: this.config.contract,
      function_selector: "decimals()",
      visible: true,
    });
    if (
      !r.result?.result ||
      !/^[0-9a-f]{64}$/i.test(r.constant_result?.[0] || "") ||
      BigInt("0x" + r.constant_result![0]) !== 6n
    )
      throw new SweepError("USDT 토큰 decimals 검증 실패");
  }
  async estimate(source: string, target: string, amount: string) {
    const r = await this.rpc<{
      result?: { result?: boolean };
      energy_used?: number;
      logs?: Receipt["log"];
    }>("wallet/triggerconstantcontract", {
      owner_address: source,
      contract_address: this.config.contract,
      function_selector: "transfer(address,uint256)",
      parameter: transferCalldata(target, amount).slice(8),
      visible: true,
    });
    if (
      !r.result?.result ||
      !r.energy_used ||
      !matchesTokenTransfer(r.logs, {
        contract: this.config.contract!,
        source,
        target,
        amount,
      })
    )
      throw new SweepError("USDT 전송 시뮬레이션 실패");
    const params = await this.rpc<{
      chainParameter?: { key: string; value: number }[];
    }>("wallet/getchainparameters", {});
    const price = unsignedInt(
        params.chainParameter?.find((p) => p.key === "getEnergyFee")?.value,
        "에너지 단가",
      ),
      bandwidth = unsignedInt(
        params.chainParameter?.find((p) => p.key === "getTransactionFee")
          ?.value,
        "Bandwidth 단가",
      );
    if (price === 0n || bandwidth === 0n)
      throw new SweepError("자원 단가 미확인");
    const resources = await this.rpc<{
      EnergyLimit?: number;
      EnergyUsed?: number;
    }>("wallet/getaccountresource", { address: source, visible: true });
    const limit = unsignedInt(resources.EnergyLimit ?? 0, "EnergyLimit"),
      used = unsignedInt(resources.EnergyUsed ?? 0, "EnergyUsed");
    return {
      ...gasBudget(
        unsignedInt(r.energy_used, "에너지"),
        limit > used ? limit - used : 0n,
        price,
        bandwidth,
      ),
      companyFee: (1000n * bandwidth + 1000000n).toString(),
    };
  }
  async buildToken(
    source: string,
    target: string,
    amount: string,
    feeLimit: number,
  ): Promise<Unsigned> {
    const r = await this.rpc<{
      result?: { result?: boolean };
      transaction?: Unsigned;
    }>("wallet/triggersmartcontract", {
      owner_address: source,
      contract_address: this.config.contract,
      function_selector: "transfer(address,uint256)",
      parameter: transferCalldata(target, amount).slice(8),
      fee_limit: feeLimit,
      call_value: 0,
      visible: true,
    });
    if (!r.result?.result || !r.transaction)
      throw new SweepError("USDT 트랜잭션 생성 실패");
    validateTransfer(r.transaction, {
      owner: source,
      contract: this.config.contract!,
      to: target,
      amount,
      feeLimit,
    });
    return r.transaction;
  }
  async buildGas(
    source: string,
    target: string,
    amount: string,
  ): Promise<NativeUnsigned> {
    const tx = await this.rpc<NativeUnsigned>("wallet/createtransaction", {
      owner_address: source,
      to_address: target,
      amount: Number(amount),
      visible: true,
    });
    validateNative(tx, { owner: source, to: target, amount });
    return tx;
  }
  receipt(txid: string) {
    return this.rpc<Partial<Receipt>>("walletsolidity/gettransactioninfobyid", {
      value: txid,
    });
  }
  native(txid: string) {
    return this.rpc<NativeUnsigned>("walletsolidity/gettransactionbyid", {
      value: txid,
    });
  }
  async broadcast(tx: Types.SignedTransaction) {
    if (tx.raw_data.expiration <= Date.now())
      throw new SweepError("만료된 TX는 재전송하지 않습니다.");
    const r = await this.rpc<{ result?: boolean; code?: string }>(
      "wallet/broadcasttransaction",
      tx,
    );
    if (!r.result && r.code !== "DUP_TRANSACTION_ERROR")
      throw new SweepError("전송 결과 미확인: 기존 TX를 계속 조회합니다.");
  }
}
