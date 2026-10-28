"use client";
import { useEffect, useRef, useState } from "react";
import { formatUsdt } from "@/lib/money";
import "./shop.css";
import { DetailContent } from "./product-content";
import type { DetailBlock } from "@/lib/product-content";
export const orderStatus: Record<string, string> = {
  paid: "결제 완료",
  cancellation_requested: "취소 승인 대기",
  cancelled: "취소·환불 완료",
};
type Order = {
  product_detail_blocks: DetailBlock[];
  id: string;
  email: string;
  member_name: string;
  product_name: string;
  product_description: string;
  quantity: number;
  unit_price: string;
  total: string;
  currency: string;
  status: string;
  created_at: string;
  cancellation_reason: string;
  refund_reason: string;
  cancelled_at: string | null;
  refund_transaction_id: string | null;
};
export function OrderAdmin() {
  const [orders, setOrders] = useState<Order[]>([]),
    [q, setQ] = useState(""),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<Order | null>(null),
    [reason, setReason] = useState(""),
    [confirmation, setConfirmation] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const lock = useRef(false);
  const detail = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected)
      detail.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);
  async function load() {
    const r = await fetch(
      "/api/admin/orders?" + new URLSearchParams({ q, status }),
      { cache: "no-store" },
    );
    if (r.status === 401) {
      location.href = "/login";
      return;
    }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setOrders(d.orders);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function decide(action: "approve" | "reject") {
    if (!selected || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: selected.id, action, reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSelected(null);
      setConfirmation(false);
      setReason("");
      await load();
      setNotice(
        action === "approve"
          ? "취소 승인·전액 환불·재고 복구가 완료되었습니다."
          : "취소 요청을 반려했습니다.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="commerce">
      <header>
        <a href="/admin">← 관리자 콘솔</a>
        <a href="/admin/shop">상품 관리</a>
      </header>
      <p className="shop-kicker">ADMIN / ORDERS</p>
      <h1>주문 관리</h1>
      <p className="shop-muted">
        취소 승인 시 결제 자산 전액 반환과 주문 수량만큼의 재고 복구가 함께
        처리됩니다.
      </p>
      <form
        className="shop-editor"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          load().catch((e) => setError(e.message));
        }}
      >
        <label>
          주문·상품·회원 검색
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={150}
          />
        </label>
        <label>
          주문 상태
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">전체</option>
            {Object.entries(orderStatus).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <button>조회</button>
      </form>
      {error && (
        <p className="shop-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="shop-success" role="status">
          {notice}
        </p>
      )}
      <p className="shop-muted">최근 조회 결과 최대 200건</p>
      {orders.map((o) => (
        <article className="shop-order" key={o.id}>
          <div>
            <strong>
              {o.product_name} × {o.quantity}
            </strong>
            <p>
              {o.member_name} · {o.email}
            </p>
            <small>
              {o.id} · {orderStatus[o.status]} ·{" "}
              {new Date(o.created_at).toLocaleString("ko-KR")}
            </small>
          </div>
          <strong>
            {formatUsdt(o.total, 6)} {o.currency === "POINT" ? "P" : "USDT"}
          </strong>
          <button
            disabled={busy}
            onClick={() => {
              setSelected(o);
              setReason("");
              setConfirmation(false);
              setNotice("");
            }}
          >
            주문 상세
          </button>
        </article>
      ))}
      {!orders.length && <p>조회된 주문이 없습니다.</p>}
      {selected && (
        <section ref={detail} className="shop-detail" aria-label="주문 상세">
          <h2>{selected.product_name}</h2>
          <p>주문번호 {selected.id}</p>
          <p>
            {selected.member_name} · {selected.email}
          </p>
          <p>
            {orderStatus[selected.status]} · 수량 {selected.quantity} · 단가{" "}
            {formatUsdt(selected.unit_price, 6)}{" "}
            {selected.currency === "POINT" ? "P" : "USDT"}
          </p>
          <DetailContent
            description={selected.product_description}
            blocks={selected.product_detail_blocks}
          />
          <p>
            취소 요청 사유: {selected.cancellation_reason || "관리자 직접 취소"}
          </p>
          {selected.status === "cancelled" ? (
            <>
              <p>환불 사유: {selected.refund_reason}</p>
              <p>환불 거래: {selected.refund_transaction_id}</p>
            </>
          ) : (
            <>
              <label>
                처리 사유
                <textarea
                  required
                  maxLength={500}
                  value={reason}
                  disabled={busy || confirmation}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {confirmation ? (
                <>
                  <p role="alert">
                    {formatUsdt(selected.total, 6)}{" "}
                    {selected.currency === "POINT" ? "P" : "USDT"}를 반환하고
                    재고 {selected.quantity}개를 복구합니다.
                  </p>
                  <button
                    className="shop-primary"
                    disabled={busy}
                    onClick={() => decide("approve")}
                  >
                    {busy ? "처리 중…" : "취소 승인 및 전액 환불 확정"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setConfirmation(false)}
                  >
                    돌아가기
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="shop-primary"
                    disabled={busy || !reason.trim()}
                    onClick={() => setConfirmation(true)}
                  >
                    취소 승인·환불 검토
                  </button>
                  {selected.status === "cancellation_requested" && (
                    <button
                      disabled={busy || !reason.trim()}
                      onClick={() => decide("reject")}
                    >
                      취소 요청 반려
                    </button>
                  )}
                </>
              )}
            </>
          )}
          <button
            disabled={busy}
            onClick={() => {
              setSelected(null);
              setConfirmation(false);
            }}
          >
            상세 닫기
          </button>
        </section>
      )}
    </main>
  );
}
