"use client";
import { getAdminData, fetchAdminData, clearAdminData } from "@/lib/admin-preload";
import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ShieldCheck, Wallet } from "lucide-react";
import { CompanyWalletBalance } from "./company-wallet-balance";
import { CompanyTransfer } from "./company-transfer";
import { useI18n } from "./i18n";

import { useState, useEffect, useRef, useCallback } from "react";
import { formatUsdt, decimalUsdt } from "@/lib/money";
import "./shop.css";
import "./sweeps.css";
type Wallet = {
  user_id: string;
  address: string;
  name: string;
  email: string;
  status: string;
  usdt: string | null;
  trx: string | null;
  error: string;
};
type Settings = {
  enabled: boolean;
  max_topup: string;
  company_reserve: string;
  version: number;
};
type Job = {
  id: string;
  email: string;
  status: string;
  network: string;
  source: string | null;
  destination: string | null;
  amount: string | null;
  max_topup: string | null;
  fee_limit: string | null;
  note: string;
  gas_txid: string | null;
  token_txid: string | null;
  gas_status: string | null;
  token_status: string | null;
  legacy_txid: string | null;
  legacy_payload: boolean;
  created_at: string;
  updated_at: string;
};
type Data = {
  wallets: Wallet[];
  settings: Settings;
  config: {
    network: string;
    contract?: string;
    company: string;
    feeLimit: number;
    issues: string[];
  };
  count: number;
  jobs: Job[];
  jobCount: number;
  canExecute: boolean;
  health: { last_seen: string; last_error: string } | null;
  companyTrx: string | null;
  companyError: string;
};
type Review = {
  id: string;
  token: string;
  network: string;
  company: string;
  companyTrx: string;
  reserve: string;
  totalFunding: string;
  expiresAt: string;
  issues: string[];
  enabled: boolean;
  items: {
    userId: string;
    source: string;
    amount: string;
    sourceTrx: string;
    topup: string;
    feeLimit: string;
  }[];
};
const statusLabels: Record<string, string> = {
  requested: "대기",
  gas_funding: "TRX 보충 중",
  gas_confirmed: "TRX 보충 확정",
  signing: "USDT 서명 준비",
  broadcast: "USDT 전송 확인 중",
  completed: "회수 완료",
  failed: "확정 실패",
  needs_review: "조사·검토 필요",
  cancelled: "취소",
};
const fmt = (v: string | null | undefined, unit: string) =>
  v === null || v === undefined ? "미확인" : `${formatUsdt(v, 6)} ${unit}`;
function txLink(id: string | null, network: string) {
  return id ? (
    <a
      href={`${network === "nile" ? "https://nile.tronscan.org" : "https://tronscan.org"}/#/transaction/${id}`}
      target="_blank"
      rel="noreferrer"
    >
      {id.slice(0, 12)}… ↗
    </a>
  ) : (
    "—"
  );
}
export function Sweeps() {
  const { tr, localeTag } = useI18n();
  const displayAmount = (value: string | null | undefined, unit: string) => tr(fmt(value, unit));
  const [data, setData] = useState<Data | null>(() => getAdminData<Data>("/api/admin/sweeps?q=&page=1&historyPage=1&scan=0")),
    [settings, setSettings] = useState<{
      enabled: boolean;
      maxTopup: string;
      reserve: string;
      version: number;
    } | null>(null),
    [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [historyPage, setHistoryPage] = useState(1),
    [selected, setSelected] = useState<string[]>([]),
    [review, setReview] = useState<Review | null>(null),
    [reason, setReason] = useState(""),
    [settingsReason, setSettingsReason] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [scanning, setScanning] = useState(false);
  const lock = useRef(false),
    sequence = useRef(0),
    inflight = useRef(0),
    busyRef = useRef(false);
  const load = useCallback(
    async (scan = false, signal?: AbortSignal) => {
      const seq = ++sequence.current;
      inflight.current++;
      if (scan) {
        setScanning(true);
        busyRef.current = true;
      }
      try {
        const endpoint = "/api/admin/sweeps?" + new URLSearchParams({ q: query, page: String(page), historyPage: String(historyPage), scan: scan ? "1" : "0" });
        const r = scan ? await fetch(endpoint, { cache: "no-store", signal }) : await fetchAdminData(endpoint, signal);
        if (r.status === 401) {
          location.href = "/login";
          return;
        }
        const d: Data & { error?: string } = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (sequence.current !== seq) return;
        setData((old) => ({
          ...d,
          companyTrx: scan ? d.companyTrx : (old?.companyTrx ?? null),
          wallets: d.wallets.map((w) => {
            const prev = old?.wallets.find(
              (v) => v.user_id === w.user_id && v.address === w.address,
            );
            return !scan && prev
              ? { ...w, usdt: prev.usdt, trx: prev.trx, error: prev.error }
              : w;
          }),
        }));
        setSettings((old) =>
          old?.version === d.settings.version
            ? old
            : {
                enabled: d.settings.enabled,
                maxTopup: decimalUsdt(BigInt(d.settings.max_topup)),
                reserve: decimalUsdt(BigInt(d.settings.company_reserve)),
                version: d.settings.version,
              },
        );
      } finally {
        inflight.current--;
        if (scan) {
          setScanning(false);
          busyRef.current = false;
        }
        setLoading(false);
      }
    },
    [query, page, historyPage],
  );
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setSelected([]);
    setReview(null);
    load(false, abort.signal).catch((e) => {
      if (e.name !== "AbortError") setError(e.message);
    });
    return () => abort.abort();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!busyRef.current && !lock.current && inflight.current === 0)
        load().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  async function act(body: unknown) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin/sweeps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      clearAdminData();
      return d;
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 실패");
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const eligible =
    data?.wallets.filter(
      (w) =>
        !w.error &&
        w.usdt !== null &&
        BigInt(w.usdt) > 0n &&
        w.address !== data.config.company,
    ) || [];
  const offline =
    !data?.health ||
    Date.now() - new Date(data.health.last_seen).getTime() > 30000;
  const total = (data?.wallets || []).reduce(
    (n, w) => n + BigInt(w.usdt || "0"),
    0n,
  );
  return (
    <main className="commerce sweep-page">
      <header>
        <Link href="/admin">{tr("← 관리자 콘솔")}</Link>
        <Link href="/admin?tab=operations">{tr("자금 운영")}</Link>
        <Link href="/admin">{tr("관리자 2단계 인증 설정")}</Link>
      </header>
      <p className="shop-kicker">ADMIN / TRC20 COLLECTION</p>
      <h1><Wallet size={23} aria-hidden="true" /> {tr("USDT 모으기")}</h1>
      <p className="shop-muted">{tr("회원 주소에 보관된 실제 USDT를 회사 지갑으로 이동합니다. 회원의 앱 USDT·포인트 잔액은 변경하지 않습니다. 조회·검토만으로 전송되지 않습니다.")}</p>
      <div className="sweep-notice"><AlertTriangle size={17} aria-hidden="true" /><span>{tr("회원 지갑의 실제 온체인 USDT를 회사 지갑으로 이동합니다. 검토 후 승인해야 회수가 진행됩니다.")}</span></div>
      {tr(error) && (
        <p role="alert" className="shop-error">
          {tr(error)}
        </p>
      )}
      {tr(notice) && (
        <p role="status" className="shop-success">
          {tr(notice)}
        </p>
      )}
      <CompanyTransfer />
      {data && (
        <>
          <div className="sweep-workspace">
          <section className="sweep-column sweep-collection">
            <div className="sweep-section-heading"><ArrowDownLeft size={17} aria-hidden="true" /><h2>{tr("회원 지갑에서 회사 지갑으로 모으기")}</h2><span className="sweep-badge">TRON TRC20</span></div>
          <form
            className="shop-section-head sweep-search"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQuery(q);
              setError("");
            }}
          >
            <label>{tr("회원·주소 검색")}<input
                value={q}
                maxLength={150}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <button disabled={busy || scanning} type="submit">{tr("검색")}</button>
            <button
              type="button"
              disabled={busy || scanning || loading}
              onClick={() => {
                setError("");
                load(true).catch((e) => setError(e.message));
              }}
            >{tr("이 페이지 온체인 잔액 조회")}</button>
          </form>
          <p className="sweep-summary">{tr("등록 주소 ")}{data.count}{tr("개 · 이 페이지 확인된 USDT")}{" "}
            {formatUsdt(total, 6)} ·{" "}
            {scanning
              ? tr("조회 중…")
              : tr("{0}개 잔액 미확인", {"0": data.wallets.filter((w) => w.usdt === null).length})}
          </p>
          <div className="sweep-table">
            <table>
              <thead>
                <tr>
                  <th>{tr("선택")}</th>
                  <th>{tr("회원 / 주소")}</th>
                  <th>{tr("확정 USDT")}</th>
                  <th>{tr("현재 TRX")}</th>
                  <th>{tr("조회 상태")}</th>
                </tr>
              </thead>
              <tbody>
                {data.wallets.map((w) => (
                  <tr key={w.user_id}>
                    <td>
                      <input
                        aria-label={tr("{0} 선택", {"0": w.email})}
                        type="checkbox"
                        disabled={
                          busy ||
                          scanning ||
                          !eligible.some((v) => v.user_id === w.user_id)
                        }
                        checked={selected.includes(w.user_id)}
                        onChange={(e) => {
                          setReview(null);
                          setSelected((a) =>
                            e.target.checked
                              ? [...a, w.user_id]
                              : a.filter((id) => id !== w.user_id),
                          );
                        }}
                      />
                    </td>
                    <td>
                      {w.name} · {w.email}
                      <small>{w.address}</small>
                      {w.status !== "active" && (
                        <small>{tr("앱 이용 제한 회원")}</small>
                      )}
                    </td>
                    <td>{displayAmount(w.usdt, "USDT")}</td>
                    <td>{displayAmount(w.trx, "TRX")}</td>
                    <td>{tr(w.error) || tr("조회 완료")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.wallets.length && <p>{tr("등록된 회원 입금 주소가 없습니다.")}</p>}
          <div className="shop-section-head sweep-pagination">
            <button
              disabled={busy || scanning || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >{tr("이전")}</button>
            <span>{page}{tr(" 페이지 · 10개씩")}</span>
            <button
              disabled={busy || scanning || page * 10 >= data.count}
              onClick={() => setPage((p) => p + 1)}
            >{tr("다음")}</button>
          </div>
          <div className="shop-section-head sweep-actions">
            <button
              disabled={busy || scanning || !eligible.length}
              onClick={() => {
                setSelected(eligible.map((w) => w.user_id));
                setReview(null);
              }}
            >{tr("이 페이지 잔액 보유 지갑 전체 선택")}</button>
            <button
              disabled={busy || scanning || !selected.length}
              onClick={async () => {
                const d = await act({ action: "review", userIds: selected });
                if (d) {
                  setReview(d);
                  setReason("");
                  setConfirmation("");
                }
              }}
            >
              {busy ? tr("처리 중…") : tr("선택 {0}개 회수 검토", {"0": selected.length})}
            </button>
          </div>
          </section>
          <aside className="sweep-column sweep-sidebar">
          <CompanyWalletBalance />
          <section className="shop-editor admin-network-status">
            <div className="sweep-section-heading"><ShieldCheck size={17} aria-hidden="true" /><h2>{tr("회사 지갑 및 실행 상태")}</h2></div>

            <p>
              {data.config.network.toUpperCase()}{tr(" · 토큰")}{" "}
              {data.config.contract || tr("미설정")}
            </p>
            <p>{tr("회사 지갑 ")}<strong>{data.config.company || tr("미설정")}</strong>
            </p>
            <p>{tr("회사 TRX ")}{displayAmount(data.companyTrx, "TRX")} {tr(data.companyError)}
            </p>
            <p>{tr("회수 ")}{data.settings.enabled ? tr("활성") : tr("중단")}{tr(" · 워커")}{" "}
              {offline ? tr("연결 확인 필요") : tr("연결됨")}
              {data.health
                ? tr(" · 마지막 응답 {0}", {"0": new Date(data.health.last_seen).toLocaleString(localeTag, { timeZone: "Asia/Seoul" })})
                : ""}
            </p>
            {data.health?.last_error && <p>{tr(data.health.last_error)}</p>}
            {data.config.issues.map((i) => (
              <p className="shop-muted" key={i}>
                • {i}
              </p>
            ))}
            {offline && (
              <p className="shop-muted">{tr("승인 후 처리는 별도 회수 워커가 수행합니다. 서버의 worker:sweep 실행 상태를 확인하세요.")}</p>
            )}
            {!data.canExecute && (
              <p className="shop-muted">{tr("조회는 가능하며 설정·승인은 최고관리자와 2단계 인증이 필요합니다.")}</p>
            )}
          </section>
          {settings && (
            <form
              className="shop-editor sweep-settings"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = await act({
                  action: "settings",
                  ...settings,
                  reason: settingsReason,
                });
                if (d) {
                  setSettingsReason("");
                  setReview(null);
                  setNotice("회수 설정을 저장했습니다.");
                  await load().catch((e) => setError(e.message));
                }
              }}
            >
              <h2>{tr("회수 운영 설정")}</h2>
              <fieldset disabled={busy || scanning || !data.canExecute}>
                <label className="shop-check">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) =>
                      setSettings({ ...settings, enabled: e.target.checked })
                    }
                  />{tr("승인된 회수 처리 활성화")}</label>
                <label>{tr("건당 TRX 보충 상한 (0~100 TRX)")}<input
                    required
                    inputMode="decimal"
                    value={settings.maxTopup}
                    onChange={(e) =>
                      setSettings({ ...settings, maxTopup: e.target.value })
                    }
                  />
                </label>
                <label>{tr("회사 최소 TRX 보유량")}<input
                    required
                    inputMode="decimal"
                    value={settings.reserve}
                    onChange={(e) =>
                      setSettings({ ...settings, reserve: e.target.value })
                    }
                  />
                </label>
                <label>{tr("설정 변경 사유")}<input
                    required
                    minLength={3}
                    maxLength={500}
                    value={settingsReason}
                    onChange={(e) => setSettingsReason(e.target.value)}
                  />
                </label>
                <button type="submit">{tr("설정 저장")}</button>
                <p className="shop-muted">{tr("회수를 중단하면 새 서명·전송을 멈춥니다. 기존 TX와 요청은 보존되며 재개 후 같은 TX의 확정을 확인합니다. 회사 주소·네트워크·서명키는 서버 설정으로 관리합니다.")}</p>
              </fieldset>
            </form>
          )}
          </aside>
          </div>
        </>
      )}
      {review && (
        <section className="shop-editor" aria-label={tr("회수 최종 검토")}>
          <h2>{tr("일괄 회수 최종 검토")}</h2>
          <p>{tr("네트워크 ")}{review.network}{tr(" · 수신 회사 지갑 ")}{review.company}
          </p>
          <p>{tr("검토 만료")}{" "}
            {new Date(review.expiresAt).toLocaleTimeString(localeTag, {
              timeZone: "Asia/Seoul",
            })}{" "}{tr("KST · 총 USDT")}{" "}
            {displayAmount(
              review.items
                .reduce((n, i) => n + BigInt(i.amount), 0n)
                .toString(),
              "USDT",
            )}
          </p>
          <p>{tr("회사 TRX ")}{displayAmount(review.companyTrx, "TRX")}{tr(" · 보충 상한 합계")}{" "}
            {displayAmount(review.totalFunding, "TRX")}{tr(" · 최소 보유")}{" "}
            {displayAmount(review.reserve, "TRX")}
          </p>
          {review.items.map((i) => (
            <article className="shop-order" key={i.userId}>
              <div>
                <strong>{i.source}</strong>
                <p>{displayAmount(i.amount, "USDT")}{tr(" → 회사")}</p>
                <p>{tr("회원 TRX ")}{displayAmount(i.sourceTrx, "TRX")}{tr(" · 보충 상한")}{" "}
                  {displayAmount(i.topup, "TRX")}{tr(" · 계약 수수료 한도")}{" "}
                  {displayAmount(i.feeLimit, "TRX")}
                </p>
              </div>
            </article>
          ))}
          {review.issues.map((i) => (
            <p className="shop-error" key={i}>
              {i}
            </p>
          ))}
          <p className="shop-muted">{tr("상한 내에서 필요한 TRX만 보충하고, 승인한 USDT 수량만 이동합니다. 이후 입금분은 다음 검토 대상입니다. 실제 수수료는 체인에서 정해지며 남은 회원 TRX는 회수하지 않습니다.")}</p>
          <label>{tr("회수 사유")}<input
              maxLength={500}
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label>{tr("확인 문구: USDT 회수")}<input
              autoComplete="off"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            className="shop-primary"
            disabled={
              busy ||
              scanning ||
              !data?.canExecute ||
              !review.enabled ||
              !!review.issues.length ||
              confirmation !== "USDT 회수" ||
              reason.trim().length < 3 ||
              new Date(review.expiresAt).getTime() <= Date.now()
            }
            onClick={async () => {
              const d = await act({
                action: "approve",
                reviewId: review.id,
                token: review.token,
                reason,
                confirmation,
              });
              if (d) {
                setReview(null);
                setSelected([]);
                setNotice(
                  `${d.jobs.length}개 회수 요청을 승인했습니다. 워커 진행 상태를 확인하세요.`,
                );
                await load().catch((e) => setError(e.message));
              }
            }}
          >{tr("검토한 일괄 회수 승인")}</button>
          <button disabled={busy} onClick={() => setReview(null)}>{tr("검토 닫기")}</button>
        </section>
      )}
      <section className="sweep-history">
      <h2>{tr("회수 진행 이력 (")}{data?.jobCount || 0})</h2>
      <p className="shop-muted">{tr("5초마다 상태를 갱신합니다. 전송 접수는 완료가 아니며 확정 영수증을 확인한 뒤 완료됩니다. 조사 필요 요청은 기존 TX 확인 전 새 전송을 만들지 않습니다.")}</p>
      {data?.jobs.map((j) => (
        <article className="shop-editor" key={j.id}>
          <h3>
            {j.email} · {tr(statusLabels[j.status]) || j.status}
          </h3>
          <p>
            {j.source || tr("기존 요청")} → {j.destination || tr("기존 회사 지갑")}
          </p>
          <p>
            {displayAmount(j.amount, "USDT")}{tr(" · 보충 상한 ")}{displayAmount(j.max_topup, "TRX")}
          </p>
          <p>
            TRX TX {txLink(j.gas_txid, j.network || data.config.network)} ·{" "}
            {j.gas_status}
          </p>
          <p>
            USDT TX{" "}
            {txLink(
              j.token_txid || j.legacy_txid,
              j.network || data.config.network,
            )}{" "}
            · {j.token_status}
          </p>
          <p>{j.note}</p>
          <small>{tr("요청 ")}{j.id} ·{" "}
            {new Date(j.created_at).toLocaleString(localeTag, {
              timeZone: "Asia/Seoul",
            })}
          </small>
          {["requested", "needs_review"].includes(j.status) &&
            !j.gas_txid &&
            !j.token_txid &&
            !j.legacy_txid &&
            !j.legacy_payload && (
              <button
                disabled={busy || !data.canExecute}
                onClick={async () => {
                  if (!window.confirm(tr("서명 전 대기 요청을 취소할까요?")))
                    return;
                  const d = await act({
                    action: "cancel",
                    id: j.id,
                    reason: "관리자 대기 요청 취소",
                  });
                  if (d) {
                    setNotice("대기 요청을 취소했습니다.");
                    await load();
                  }
                }}
              >{tr("서명 전 요청 취소")}</button>
            )}
        </article>
      ))}
      <div className="shop-section-head">
        <button
          disabled={busy || historyPage === 1}
          onClick={() => setHistoryPage((p) => p - 1)}
        >{tr("이전 이력")}</button>
        <span>{historyPage}{tr(" 페이지")}</span>
        <button
          disabled={busy || historyPage * 50 >= (data?.jobCount || 0)}
          onClick={() => setHistoryPage((p) => p + 1)}
        >{tr("다음 이력")}</button>
      </div>
      </section>
    </main>
  );
}
