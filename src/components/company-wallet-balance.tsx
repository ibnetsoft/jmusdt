"use client";
import { useState } from "react";
import { RefreshCw, Wallet } from "lucide-react";
import { formatUsdt } from "@/lib/money";
import { useI18n } from "./i18n";

type Snapshot = { network: string; address: string; usdt: string; trx: string; checkedAt: string };
export function CompanyWalletBalance() {
  const { tr } = useI18n();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/company-wallet", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSnapshot(result);
    } catch (e) { setSnapshot(null); setError(e instanceof Error ? e.message : "잔액 조회 실패"); }
    finally { setBusy(false); }
  }
  return <section className="shop-editor company-wallet-balance">
    <div className="sweep-section-heading"><Wallet size={17} aria-hidden="true" /><h2>{tr("회사 지갑 잔액")}</h2><button type="button" onClick={refresh} disabled={busy}><RefreshCw size={14} aria-hidden="true" /> {tr("잔액 조회")}</button></div>
    {snapshot ? <><p>{snapshot.network.toUpperCase()} · {snapshot.address}</p><div className="company-wallet-amounts"><div><small>USDT</small><strong>{formatUsdt(snapshot.usdt, 6)} USDT</strong></div><div><small>TRX</small><strong>{formatUsdt(snapshot.trx, 6)} TRX</strong></div></div></> : <p className="shop-muted">{tr("잔액 조회를 눌러 온체인 잔액을 확인하세요.")}</p>}
    {error && <p className="shop-error" role="alert">{tr(error)}</p>}
  </section>;
}
