"use client";
import { useI18n } from "./i18n";
import { readPreloadedData, fetchPageData } from "@/lib/preload-pages";
import { BottomNav } from "./bottom-nav";

import { useEffect, useState, useRef } from "react";
import { rewardLabels } from "@/lib/marketing-plan";
import { formatUsdt } from "@/lib/money";
import "./shop.css";
import "./rewards.css";
type Kind = keyof typeof rewardLabels;
const directKinds = ["referral", "sponsor", "mom", "daily"] as const;
const statuses: Record<string, string> = {
  scheduled: "지급 예정",
  paid: "지급 완료",
  skipped: "미지급",
  reversed: "회수 완료",
  void: "권리 취소",
};
type Reward = {
  id: string;
  order_id: string;
  product_name: string;
  user_id: string | null;
  name?: string;
  email?: string;
  type: Kind;
  amount: string;
  status: string;
  reason: string;
  due_date: string;
  installment: number;
  created_at: string;
  transaction_id: string | null;
};
type Total = { type: Kind; status: string; amount: string; count: number };
type Settings = { enabled: boolean; daily_paused: boolean; version: number };
type Data = {
  rewards: Reward[];
  totals?: Total[];
  summary?: Total[];
  debt?: string;
  debts?: { user_id: string; name: string; email: string; amount: string }[];
  settings?: Settings;
  count?: number;
  pools?: {kind:"lucky"|"treasure";cutoff:string;quantity:string;amount:string}[];
  packages?: {package_type:"lucky"|"treasure";quantity:string}[];
  poolBalances?: {kind:"lucky"|"treasure";cutoff:string;amount:string}[];
  poolRuns?: {kind:"lucky"|"treasure";cutoff:string;total:string;distributed:string;retained:string;package_count:string}[];
};
function amount(units: string) {
  return `${formatUsdt(units, 0)} P`;
}
export function Rewards({ admin = false }: { admin?: boolean }) {
  const { tr, localeTag } = useI18n();
  const [data, setData] = useState<Data | null>(null),
    [settings, setSettings] = useState<Settings | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [type, setType] = useState("all"),
    [status, setStatus] = useState("all"),
    [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    let networkDone = false;
    if (!admin && revision === 0) void readPreloadedData<Data>("/api/rewards").then(cached => {
      if (!controller.signal.aborted && !networkDone && cached) { setData(cached); setLoading(false); }
    });
    const endpoint = admin
      ? "/api/admin/marketing?" +
        new URLSearchParams({ type, status, q: query, page: String(page) })
      : "/api/rewards";
    (admin ? fetch(endpoint, { cache: "no-store", signal: controller.signal }) : fetchPageData(endpoint, controller.signal))
      .then(async (r) => {
        if (r.status === 401) {
          location.href = "/login";
          return;
        }
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        networkDone = true;
        setData(d);
        if (d.settings) setSettings(d.settings);
      })
      .catch((e) => {
        networkDone = true;
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [admin, type, status, query, page, revision]);
  async function action(body: unknown) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setNotice(
        d.poolRuns !== undefined
          ? `일일 마감 ${d.poolRuns}건을 처리했습니다.`
          : d.paid === undefined
          ? "설정을 저장했습니다."
          : `기한이 도래한 데일리 ${d.paid}건을 지급했습니다. 미처리 건은 다시 실행할 수 있습니다.`,
      );
      setReason("");
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const totals = data?.totals || data?.summary || [];
  return (
    <>
    <main className="commerce marketing-rewards">
      <header>
        {admin && <a href="/admin">← {tr("관리자 콘솔")}</a>}
        <a href={admin ? "/admin/shop" : "/shop"}>
          {admin ? tr("상품별 보상 설정") : tr("쇼핑몰")}
        </a>
        {!admin && <a href="/organization">{tr("조직도")}</a>}
      </header>
      <p className="shop-kicker">WU / MARKETING</p>
      <h1>{admin ? tr("마케팅 관리") : tr("나의 리워드")}</h1>
      <p className="shop-muted">{tr("추천·후원·맘리워드는 실시간으로 지급됩니다. 데일리·복주머니·보물상자는 매일 한국시간 자정에 포인트로 배당됩니다. 데일리는 구매 다음 날부터, 복주머니·보물상자는 보유 패키지 수량에 비례해 지급됩니다.")}</p>
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
      {admin ? <section className="shop-editor"><h2>{tr("회사 일일 적립 및 마감")}</h2>{data?.poolBalances?.map(p=><p key={p.kind+p.cutoff}>{p.kind==='lucky'?tr("복주머니P"):tr("보물상자P")} · {new Date(p.cutoff).toLocaleString(localeTag,{timeZone:'Asia/Seoul'})}{tr(" 마감 · ")}{formatUsdt(p.amount, 0)} P</p>)}{data?.poolRuns?.map(r=><p key={r.kind+r.cutoff}>{r.kind==='lucky'?tr("복주머니P"):tr("보물상자P")} · {new Date(r.cutoff).toLocaleString(localeTag,{timeZone:'Asia/Seoul'})}{tr(" · 적립 ")}{formatUsdt(r.total, 0)}{tr(" P · 지급 ")}{formatUsdt(r.distributed, 0)}{tr(" P · 회사 잔여 ")}{formatUsdt(r.retained, 0)}{tr(" P · 패키지 ")}{r.package_count}{tr("개")}</p>)}</section> : <section className="shop-editor"><h2>{tr("일일 패키지와 분배")}</h2><p>{tr("복주머니패키지 ")}{data?.packages?.find(p=>p.package_type==='lucky')?.quantity || '0'}{tr("개 · 보물상자패키지 ")}{data?.packages?.find(p=>p.package_type==='treasure')?.quantity || '0'}{tr("개")}</p>{data?.pools?.map(w=><p key={w.kind+w.cutoff}>{w.kind==='lucky'?tr("복주머니P"):tr("보물상자P")} · {new Date(w.cutoff).toLocaleString(localeTag,{timeZone:'Asia/Seoul'})} · {w.quantity}{tr("개 기준 · ")}{formatUsdt(w.amount, 0)}{tr(" P 지급")}</p>)}</section>}
      <button
        disabled={busy || loading}
        onClick={() => setRevision((n) => n + 1)}
      >{tr("새로고침")}</button>
      {admin && settings && (
        <form
          className="shop-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void action({
              action: "settings",
              version: settings.version,
              enabled: settings.enabled,
              dailyPaused: settings.daily_paused,
              reason,
            });
          }}
        >
          <h2>{tr("운영 설정")}</h2>
          <fieldset disabled={busy || loading}>
            <label className="shop-check">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) =>
                  setSettings({ ...settings, enabled: e.target.checked })
                }
              />{tr("신규 구매 추천·후원·맘·데일리 적용")}</label>
            <label className="shop-check">
              <input
                type="checkbox"
                checked={settings.daily_paused}
                onChange={(e) =>
                  setSettings({ ...settings, daily_paused: e.target.checked })
                }
              />{tr("데일리 지급 일시정지")}</label>
            <p className="shop-muted">{tr("회사 복주머니P·보물상자P는 모든 상품 매출에서 적립됩니다. 신규 구매 적용을 꺼도 기존 주문의 권리는 유지됩니다. 일시정지 중 밀린 데일리는 재개 후 지급됩니다. 취소 요청 중인 주문은 지급이 보류됩니다. 금액과 수량은 상품 관리에서 입력합니다.")}</p>
            <label>{tr("변경 사유")}<input
                required
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button type="submit" className="shop-primary">{tr("설정 저장")}</button>
            <button
              type="button"
              disabled={settings.daily_paused}
              onClick={() => void action({ action: "daily" })}
            >{tr("기한 도래 데일리 지급 / 누락 재처리")}</button>
            <button type="button" disabled={!reason.trim()} onClick={()=>void action({action:"pools",reason})}>{tr("기한 도래 일일 마감 재처리")}</button>
          </fieldset>
        </form>
      )}
      <section className="shop-grid" aria-label={tr("보상 합계")}>
        {directKinds.map((k) => (
          <article className="shop-editor" key={k}>
            <h2>{tr(rewardLabels[k])}</h2>
            {["paid", "scheduled", "reversed", "skipped", "void"].map((s) => {
              const t = totals.find((t) => t.type === k && t.status === s);
              return t ? (
                <p key={s}>
                  {tr(statuses[s])}{" "}
                  <strong>{amount(t.amount)}</strong>
                </p>
              ) : null;
            })}
            {!totals.some((t) => t.type === k) && <p>{tr("내역이 없습니다.")}</p>}
          </article>
        ))}
      </section>
      {!admin && BigInt(data?.debt || "0") > 0n && (
        <p className="shop-error">{tr("취소 보상 미수금 ")}{formatUsdt(data!.debt!, 0)}{tr(" P. 이후 포인트 유입에서 자동 상계됩니다. 전환·환불 시 사용 가능 잔액에 반영됩니다.")}</p>
      )}
      {admin && !!data?.debts?.length && (
        <section className="shop-editor">
          <h2>{tr("회수 미수금 (상위 100명)")}</h2>
          {data.debts.map((d) => (
            <p key={d.user_id}>
              {d.name} · {d.email} — {formatUsdt(d.amount, 0)} P
            </p>
          ))}
        </section>
      )}
      {admin && (
        <form
          className="shop-section-head"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(q);
            setRevision((n) => n + 1);
          }}
        >
          <label>{tr("종류")}<select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">{tr("전체")}</option>
              {directKinds.map((v) => (
                <option key={v} value={v}>
                  {tr(rewardLabels[v])}
                </option>
              ))}
            </select>
          </label>
          <label>{tr("상태")}<select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">{tr("전체")}</option>
              {Object.entries(statuses).map(([v, l]) => (
                <option key={v} value={v}>
                  {tr(l)}
                </option>
              ))}
            </select>
          </label>
          <label>{tr("회원·주문 검색")}<input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={150}
            />
          </label>
          <button type="submit">{tr("검색")}</button>
        </form>
      )}
      <h2>{tr("보상 내역 ")}{admin && data ? tr("({0}건)", {"0": data.count}) : tr("(최근 200건)")}</h2>
      {!loading && (
        data?.rewards.map((r) => (
          <article key={r.id} className="shop-order">
            <div>
              <strong>
                {tr(rewardLabels[r.type])} · {amount(r.amount)}
              </strong>
              <p>
                {tr(r.product_name)} · {tr(statuses[r.status])}
                {r.installment > 0
                  ? tr(" · {0}회차 / {1}", {"0": r.installment, "1": r.due_date.slice(0, 10)})
                  : ""}
              </p>
              {admin && (
                <p>
                  {r.name || tr("수령인 없음")} {r.email}
                </p>
              )}
              <small>{tr("주문 ")}{r.order_id}</small>
              {r.transaction_id && (
                <p>
                  <small>{tr("거래 ")}{r.transaction_id}</small>
                </p>
              )}
              {r.reason && <p className="shop-muted">{r.reason}</p>}
            </div>
          </article>
        ))
      )}
      {!loading && data && !data.rewards.length && <p>{tr("보상 내역이 없습니다.")}</p>}
      {admin && (
        <div className="shop-section-head">
          <button
            disabled={page === 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >{tr("이전")}</button>
          <span>{page}{tr(" 페이지")}</span>
          <button
            disabled={loading || page * 100 >= (data?.count || 0)}
            onClick={() => setPage((p) => p + 1)}
          >{tr("다음")}</button>
        </div>
      )}
    </main>
    {!admin && <BottomNav />}
    </>
  );
}
