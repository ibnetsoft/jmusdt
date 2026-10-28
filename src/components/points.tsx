"use client";
import { useEffect, useRef, useState } from "react";
import { formatUsdt, parseUsdt } from "@/lib/money";
import "./shop.css";
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
export function Points() {
  const [data, setData] = useState<Data | null>(null),
    [direction, setDirection] = useState("usdt_to_points"),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const key = useRef("");
  const lock = useRef(false);
  async function load() {
    const r = await fetch("/api/points", { cache: "no-store" });
    if (r.status === 401) {
      location.href = "/login";
      return;
    }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function swap() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, amount, requestKey: key.current }),
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
    <main className="commerce">
      <header>
        <a href="/">← 내 지갑</a>
        <a href="/shop">쇼핑몰 ↗</a>
      </header>
      <p className="shop-kicker">JMUSDT / POINTS</p>
      <h1>포인트 전환</h1>
      <p className="shop-muted">1 USDT = 1 포인트 · 수수료 0 · 소수점 6자리</p>
      {BigInt(data?.debt || "0") > 0n && (
        <p className="shop-error">
          취소 보상 미수금 {formatUsdt(data!.debt, 6)} P가 있습니다. USDT →
          포인트 전환 시 미수금이 우선 상계되므로 실제 사용 가능 포인트는
          전환액보다 적을 수 있습니다.
        </p>
      )}
      <p>
        포인트로 쇼핑몰 상품을 구매하세요. 전환은 내부 잔액에서 즉시 처리됩니다.
      </p>
      {data && (
        <div className="shop-balance">
          <strong>{formatUsdt(data.usdt, 6)} USDT</strong>
          <strong>{formatUsdt(data.points, 6)} P</strong>
        </div>
      )}
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
      <form
        className="shop-editor"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          try {
            const units = parseUsdt(amount);
            if (
              !data ||
              units >
                BigInt(direction === "usdt_to_points" ? data.usdt : data.points)
            )
              throw new Error("전환할 잔액이 부족합니다.");
            key.current = crypto.randomUUID();
            setConfirm(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : "금액 확인");
          }
        }}
      >
        <fieldset disabled={busy || confirm}>
          <label>
            전환 방향
            <select
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value);
                setNotice("");
              }}
            >
              <option value="usdt_to_points">USDT → 포인트</option>
              <option value="points_to_usdt">포인트 → USDT</option>
            </select>
          </label>
          <label>
            전환 금액
            <input
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setNotice("");
              }}
            />
          </label>
          <button className="shop-primary" disabled={!data}>
            전환 내용 확인
          </button>
        </fieldset>
        {confirm && (
          <section aria-label="전환 최종 확인">
            <p>
              {amount}{" "}
              {direction === "usdt_to_points"
                ? "USDT → " + amount + " P"
                : "P → " + amount + " USDT"}
            </p>
            <button
              className="shop-primary"
              type="button"
              disabled={busy}
              onClick={swap}
            >
              {busy ? "처리 중…" : "1:1 전환 확정"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              취소
            </button>
          </section>
        )}
      </form>
      <h2>전환 내역</h2>
      {data?.history.map((h) => (
        <article className="shop-order" key={h.id}>
          <span>
            {h.direction === "usdt_to_points"
              ? "USDT → 포인트"
              : "포인트 → USDT"}
            <small> · {new Date(h.created_at).toLocaleString("ko-KR")}</small>
          </span>
          <strong>{formatUsdt(h.amount, 6)}</strong>
        </article>
      ))}
      {data?.history.length === 0 && <p>아직 전환 내역이 없습니다.</p>}
    </main>
  );
}
