"use client";
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
  const [data, setData] = useState<Data | null>(null),
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
        const r = await fetch(
          "/api/admin/sweeps?" +
            new URLSearchParams({
              q: query,
              page: String(page),
              historyPage: String(historyPage),
              scan: scan ? "1" : "0",
            }),
          { cache: "no-store", signal },
        );
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
        <a href="/admin">← 관리자 콘솔</a>
        <a href="/admin#operations">자금 운영</a>
        <a href="/admin">관리자 2단계 인증 설정</a>
      </header>
      <p className="shop-kicker">ADMIN / TRC20 COLLECTION</p>
      <h1>USDT 모으기</h1>
      <p className="shop-muted">
        회원 주소에 보관된 실제 USDT를 회사 지갑으로 이동합니다. 회원의 앱
        USDT·포인트 잔액은 변경하지 않습니다. 조회·검토만으로 전송되지 않습니다.
      </p>
      {error && (
        <p role="alert" className="shop-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="shop-success">
          {notice}
        </p>
      )}
      {data && (
        <>
          <section className="shop-editor">
            <h2>네트워크·실행 상태</h2>
            <p>
              {data.config.network.toUpperCase()} · 토큰{" "}
              {data.config.contract || "미설정"}
            </p>
            <p>
              회사 지갑 <strong>{data.config.company || "미설정"}</strong>
            </p>
            <p>
              회사 TRX {fmt(data.companyTrx, "TRX")} {data.companyError}
            </p>
            <p>
              회수 {data.settings.enabled ? "활성" : "중단"} · 워커{" "}
              {offline ? "연결 확인 필요" : "연결됨"}
              {data.health
                ? ` · 마지막 응답 ${new Date(data.health.last_seen).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`
                : ""}
            </p>
            {data.health?.last_error && <p>{data.health.last_error}</p>}
            {data.config.issues.map((i) => (
              <p className="shop-muted" key={i}>
                • {i}
              </p>
            ))}
            {offline && (
              <p className="shop-muted">
                승인 후 처리는 별도 회수 워커가 수행합니다. 서버의 worker:sweep
                실행 상태를 확인하세요.
              </p>
            )}
            {!data.canExecute && (
              <p className="shop-muted">
                조회는 가능하며 설정·승인은 최고관리자와 2단계 인증이
                필요합니다.
              </p>
            )}
          </section>
          {settings && (
            <form
              className="shop-editor"
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
              <h2>회수 운영 설정</h2>
              <fieldset disabled={busy || scanning || !data.canExecute}>
                <label className="shop-check">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) =>
                      setSettings({ ...settings, enabled: e.target.checked })
                    }
                  />
                  승인된 회수 처리 활성화
                </label>
                <label>
                  건당 TRX 보충 상한 (0~100 TRX)
                  <input
                    required
                    inputMode="decimal"
                    value={settings.maxTopup}
                    onChange={(e) =>
                      setSettings({ ...settings, maxTopup: e.target.value })
                    }
                  />
                </label>
                <label>
                  회사 최소 TRX 보유량
                  <input
                    required
                    inputMode="decimal"
                    value={settings.reserve}
                    onChange={(e) =>
                      setSettings({ ...settings, reserve: e.target.value })
                    }
                  />
                </label>
                <label>
                  설정 변경 사유
                  <input
                    required
                    minLength={3}
                    maxLength={500}
                    value={settingsReason}
                    onChange={(e) => setSettingsReason(e.target.value)}
                  />
                </label>
                <button type="submit">설정 저장</button>
                <p className="shop-muted">
                  회수를 중단하면 새 서명·전송을 멈춥니다. 기존 TX와 요청은
                  보존되며 재개 후 같은 TX의 확정을 확인합니다. 회사
                  주소·네트워크·서명키는 서버 설정으로 관리합니다.
                </p>
              </fieldset>
            </form>
          )}
          <form
            className="shop-section-head"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQuery(q);
              setError("");
            }}
          >
            <label>
              회원·주소 검색
              <input
                value={q}
                maxLength={150}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <button disabled={busy || scanning} type="submit">
              검색
            </button>
            <button
              type="button"
              disabled={busy || scanning || loading}
              onClick={() => {
                setError("");
                load(true).catch((e) => setError(e.message));
              }}
            >
              이 페이지 온체인 잔액 조회
            </button>
          </form>
          <p>
            등록 주소 {data.count}개 · 이 페이지 확인된 USDT{" "}
            {formatUsdt(total, 6)} ·{" "}
            {scanning
              ? "조회 중…"
              : `${data.wallets.filter((w) => w.usdt === null).length}개 잔액 미확인`}
          </p>
          <div className="sweep-table">
            <table>
              <thead>
                <tr>
                  <th>선택</th>
                  <th>회원 / 주소</th>
                  <th>확정 USDT</th>
                  <th>현재 TRX</th>
                  <th>조회 상태</th>
                </tr>
              </thead>
              <tbody>
                {data.wallets.map((w) => (
                  <tr key={w.user_id}>
                    <td>
                      <input
                        aria-label={`${w.email} 선택`}
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
                        <small>앱 이용 제한 회원</small>
                      )}
                    </td>
                    <td>{fmt(w.usdt, "USDT")}</td>
                    <td>{fmt(w.trx, "TRX")}</td>
                    <td>{w.error || "조회 완료"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.wallets.length && <p>등록된 회원 입금 주소가 없습니다.</p>}
          <div className="shop-section-head">
            <button
              disabled={busy || scanning || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              이전
            </button>
            <span>{page} 페이지 · 10개씩</span>
            <button
              disabled={busy || scanning || page * 10 >= data.count}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </button>
          </div>
          <div className="shop-section-head">
            <button
              disabled={busy || scanning || !eligible.length}
              onClick={() => {
                setSelected(eligible.map((w) => w.user_id));
                setReview(null);
              }}
            >
              이 페이지 잔액 보유 지갑 전체 선택
            </button>
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
              {busy ? "처리 중…" : `선택 ${selected.length}개 회수 검토`}
            </button>
          </div>
        </>
      )}
      {review && (
        <section className="shop-editor" aria-label="회수 최종 검토">
          <h2>일괄 회수 최종 검토</h2>
          <p>
            네트워크 {review.network} · 수신 회사 지갑 {review.company}
          </p>
          <p>
            검토 만료{" "}
            {new Date(review.expiresAt).toLocaleTimeString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}{" "}
            KST · 총 USDT{" "}
            {fmt(
              review.items
                .reduce((n, i) => n + BigInt(i.amount), 0n)
                .toString(),
              "USDT",
            )}
          </p>
          <p>
            회사 TRX {fmt(review.companyTrx, "TRX")} · 보충 상한 합계{" "}
            {fmt(review.totalFunding, "TRX")} · 최소 보유{" "}
            {fmt(review.reserve, "TRX")}
          </p>
          {review.items.map((i) => (
            <article className="shop-order" key={i.userId}>
              <div>
                <strong>{i.source}</strong>
                <p>{fmt(i.amount, "USDT")} → 회사</p>
                <p>
                  회원 TRX {fmt(i.sourceTrx, "TRX")} · 보충 상한{" "}
                  {fmt(i.topup, "TRX")} · 계약 수수료 한도{" "}
                  {fmt(i.feeLimit, "TRX")}
                </p>
              </div>
            </article>
          ))}
          {review.issues.map((i) => (
            <p className="shop-error" key={i}>
              {i}
            </p>
          ))}
          <p className="shop-muted">
            상한 내에서 필요한 TRX만 보충하고, 승인한 USDT 수량만 이동합니다.
            이후 입금분은 다음 검토 대상입니다. 실제 수수료는 체인에서 정해지며
            남은 회원 TRX는 회수하지 않습니다.
          </p>
          <label>
            회수 사유
            <input
              maxLength={500}
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label>
            확인 문구: USDT 회수
            <input
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
          >
            검토한 일괄 회수 승인
          </button>
          <button disabled={busy} onClick={() => setReview(null)}>
            검토 닫기
          </button>
        </section>
      )}
      <h2>회수 진행 이력 ({data?.jobCount || 0})</h2>
      <p className="shop-muted">
        5초마다 상태를 갱신합니다. 전송 접수는 완료가 아니며 확정 영수증을
        확인한 뒤 완료됩니다. 조사 필요 요청은 기존 TX 확인 전 새 전송을 만들지
        않습니다.
      </p>
      {data?.jobs.map((j) => (
        <article className="shop-editor" key={j.id}>
          <h3>
            {j.email} · {statusLabels[j.status] || j.status}
          </h3>
          <p>
            {j.source || "기존 요청"} → {j.destination || "기존 회사 지갑"}
          </p>
          <p>
            {fmt(j.amount, "USDT")} · 보충 상한 {fmt(j.max_topup, "TRX")}
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
          <small>
            요청 {j.id} ·{" "}
            {new Date(j.created_at).toLocaleString("ko-KR", {
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
                  if (!window.confirm("서명 전 대기 요청을 취소할까요?"))
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
              >
                서명 전 요청 취소
              </button>
            )}
        </article>
      ))}
      <div className="shop-section-head">
        <button
          disabled={busy || historyPage === 1}
          onClick={() => setHistoryPage((p) => p - 1)}
        >
          이전 이력
        </button>
        <span>{historyPage} 페이지</span>
        <button
          disabled={busy || historyPage * 50 >= (data?.jobCount || 0)}
          onClick={() => setHistoryPage((p) => p + 1)}
        >
          다음 이력
        </button>
      </div>
    </main>
  );
}
