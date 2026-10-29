"use client";
import { useI18n } from "./i18n";

import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, ArrowLeft, ChevronLeft, Clock3 } from "lucide-react";
import { formatUsdt, parseUsdt } from "@/lib/money";
import "./points.css";
type Data = {
  usdt: string;
  points: string;
  debt: string;
  history: {
    id: string;
    direction: string;
    amount: string;
    created_at: string;
  }[];
};
type Direction = "usdt_to_points" | "points_to_usdt";
const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"];
function displayAmount(units: string | bigint) {
  return formatUsdt(units, 6).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
export function Points() {
  const { tr, localeTag } = useI18n();
  const [data, setData] = useState<Data | null>(null),
    [direction, setDirection] = useState<Direction>("usdt_to_points"),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const key = useRef("");
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const toPoints = direction === "usdt_to_points";
  const sourceUnit = toPoints ? "USDT" : "P", targetUnit = toPoints ? "P" : "USDT";
  const submittedAmount = amount.endsWith(".") ? amount.slice(0, -1) : amount;
  let units = 0n;
  try { units = parseUsdt(submittedAmount); } catch { /* An empty or zero amount is not ready to convert. */ }
  const insufficient = !!data && units > BigInt(toPoints ? data.usdt : data.points);
  const canReview = !!data && units > 0n && !insufficient && !busy;
  async function load(signal?: AbortSignal) {
    const r = await fetch("/api/points", { cache: "no-store", signal });
    if (r.status === 401) {
      location.href = "/login";
      return;
    }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setData(d);
  }
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirm]);
  function editAmount(value: string) {
    let next = value.replace(/,/g, "").trim();
    if (next.startsWith(".")) next = "0" + next;
    next = next.replace(/^0+(?=\d)/, "");
    // Match the checkout API's 10 whole digits and six fractional digits.
    if (!/^\d{0,10}(\.\d{0,6})?$/.test(next)) return;
    setAmount(next);
    setNotice("");
    setError("");
  }
  function changeDirection(next: Direction) {
    if (busy || confirm) return;
    setDirection(next);
    setNotice("");
    setError("");
  }
  async function swap() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, amount: submittedAmount, requestKey: key.current }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setConfirm(false);
      setAmount("");
      setNotice("1:1 전환이 완료되었습니다.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "전환 실패");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="points-page">
      <form className="points-exchange"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canReview || confirm) return;
          setError("");
          key.current = crypto.randomUUID();
          setConfirm(true);
        }}
      >
        <header className="points-header">
          <a className="points-icon-button" href="/" aria-label={tr("내 지갑으로 돌아가기")}><ChevronLeft aria-hidden="true" size={28} /></a>
          <h1>{tr("포인트 전환")}</h1>
          <a className="points-icon-button" href="#points-history" aria-label={tr("전환 내역")}><Clock3 aria-hidden="true" size={21} /></a>
        </header>
        <div className="points-tabs" role="group" aria-label={tr("전환 방향")}>
          <button type="button" aria-pressed={toPoints} disabled={busy || confirm} onClick={() => changeDirection("usdt_to_points")}>{tr("포인트로 전환")}</button>
          <button type="button" aria-pressed={!toPoints} disabled={busy || confirm} onClick={() => changeDirection("points_to_usdt")}>{tr("USDT로 전환")}</button>
        </div>
        <div className="points-rate"><strong>1 USDT = 1 P</strong><span>{tr("수수료 0")}</span></div>
        <div className="points-assets">
          <div className="points-asset points-source">
            <div className="points-asset-info">
              <span className="points-asset-name"><span className="points-token" aria-hidden="true">{toPoints ? "₮" : "P"}</span>{toPoints ? "USDT" : tr("포인트")}</span>
              <p>{tr("잔액")} {data ? displayAmount(toPoints ? data.usdt : data.points) + " " + sourceUnit : "—"}</p>
            </div>
            <label className={`points-amount ${amount.length > 12 ? "points-amount-long" : amount.length > 8 ? "points-amount-medium" : ""}`}>
              <input aria-label={tr("전환 금액")} aria-describedby="points-input-hint" inputMode="none" autoComplete="off" spellCheck={false} placeholder="0" value={amount} disabled={!data || busy || confirm} onChange={e => editAmount(e.target.value)} />
              <span>{sourceUnit}</span>
            </label>
          </div>
          <button className="points-switch" type="button" disabled={busy || confirm} aria-label={tr("전환 방향 바꾸기")} onClick={() => changeDirection(toPoints ? "points_to_usdt" : "usdt_to_points")}><ArrowDownUp aria-hidden="true" size={19} /></button>
          <div className="points-asset points-target">
            <div className="points-asset-info">
              <span className="points-asset-name"><span className="points-token" aria-hidden="true">{toPoints ? "P" : "₮"}</span>{toPoints ? tr("포인트") : "USDT"}</span>
              <p>{tr("잔액")} {data ? displayAmount(toPoints ? data.points : data.usdt) + " " + targetUnit : "—"}</p>
            </div>
            <output className={`points-output ${amount.length > 12 ? "points-amount-long" : ""}`} aria-label={tr("전환 예상 금액")} aria-live="polite">{displayAmount(units)} <span>{targetUnit}</span></output>
          </div>
        </div>
        <p className="points-input-hint" id="points-input-hint">{tr("소수점 6자리까지 입력할 수 있어요.")}</p>
        {BigInt(data?.debt || "0") > 0n && <p className="points-message points-warning">{tr("취소 보상 미수금 ")}{formatUsdt(data!.debt, 6)}{tr(" P가 있습니다. USDT → 포인트 전환 시 미수금이 우선 상계되므로 실제 사용 가능 포인트는 전환액보다 적을 수 있습니다.")}</p>}
        {insufficient && <p role="alert" className="points-message points-error">{tr("전환할 잔액이 부족합니다.")}</p>}
        {error && !confirm && <p role="alert" className="points-message points-error">{tr(error)} {!data && <button type="button" onClick={() => { setError(""); load().catch(e => setError(e.message)); }}>{tr("새로고침")}</button>}</p>}
        {notice && <p role="status" className="points-message points-success">{tr(notice)}</p>}
        <div className="points-keypad" role="group" aria-label={tr("숫자 키패드")}>
          {keypad.map(value => <button key={value} type="button" disabled={!data || busy || confirm} aria-label={value === "backspace" ? tr("마지막 숫자 지우기") : value === "." ? tr("소수점") : value} onClick={() => editAmount(value === "backspace" ? amount.slice(0, -1) : amount + value)}>{value === "backspace" ? <ArrowLeft aria-hidden="true" size={29} strokeWidth={1.8} /> : value}</button>)}
        </div>
        <button className="points-primary points-review" type="submit" aria-label={tr("전환 내용 확인")} disabled={!canReview || confirm}>{tr("확인")}</button>
      </form>
      <dialog ref={dialog} className="points-confirm" aria-labelledby="points-confirm-title" onCancel={e => { e.preventDefault(); if (!busy) setConfirm(false); }}>
        <h2 id="points-confirm-title">{tr("전환 최종 확인")}</h2>
        <p className="points-confirm-amount">{displayAmount(units)} {sourceUnit}<span aria-hidden="true">↓</span>{displayAmount(units)} {targetUnit}</p>
        <p className="points-input-hint">{tr("1 USDT = 1 포인트 · 수수료 0 · 소수점 6자리")}</p>
        {toPoints && BigInt(data?.debt || "0") > 0n && <p className="points-message points-warning">{tr("취소 보상 미수금 ")}{formatUsdt(data!.debt, 6)}{tr(" P가 있습니다. USDT → 포인트 전환 시 미수금이 우선 상계되므로 실제 사용 가능 포인트는 전환액보다 적을 수 있습니다.")}</p>}
        {error && <p className="points-message points-error" role="alert">{tr(error)}</p>}
        <button className="points-primary" type="button" disabled={busy} onClick={swap}>{busy ? tr("처리 중…") : tr("1:1 전환 확정")}</button>
        <button className="points-cancel" type="button" disabled={busy} onClick={() => { setConfirm(false); setError(""); }}>{tr("취소")}</button>
      </dialog>
      <section className="points-history" id="points-history" aria-labelledby="points-history-title">
        <div className="points-history-heading"><h2 id="points-history-title">{tr("전환 내역")}</h2><a href="/shop">{tr("쇼핑몰 ↗")}</a></div>
        {data?.history.map((h) => (
          <article className="points-history-item" key={h.id}>
            <div><strong>{h.direction === "usdt_to_points" ? tr("USDT → 포인트") : tr("포인트 → USDT")}</strong><time dateTime={h.created_at}>{new Date(h.created_at).toLocaleString(localeTag, { timeZone: "Asia/Seoul" })}</time></div>
            <span>{displayAmount(h.amount)} <small>{h.direction === "usdt_to_points" ? "P" : "USDT"}</small></span>
          </article>
        ))}
        {data?.history.length === 0 && <p className="points-empty">{tr("아직 전환 내역이 없습니다.")}</p>}
      </section>
    </main>
  );
}
