"use client";
import Link from "next/link";
import { useI18n } from "./i18n";
import { getAdminData, fetchAdminData, clearAdminData } from "@/lib/admin-preload";

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
  shipping: {recipient:string; phone:string; address:string; note:string; status:"preparing"|"shipped"|"delivered"; carrier:string; tracking_number:string} | null;
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
  const { tr, localeTag } = useI18n();
  const [orders, setOrders] = useState<Order[]>(() => getAdminData<{orders: Order[]}>("/api/admin/orders?q=&status=all")?.orders ?? []),
    [q, setQ] = useState(""),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<Order | null>(null),
    [reason, setReason] = useState(""),
    [confirmation, setConfirmation] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const lock = useRef(false);
  const [deliveryStatus, setDeliveryStatus] = useState<"preparing"|"shipped"|"delivered">("preparing");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const detail = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected)
      detail.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);
  async function load() {
    const r = await fetchAdminData("/api/admin/orders?" + new URLSearchParams({ q, status }));
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
      clearAdminData();
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
  async function saveShipping() {
    if (!selected?.shipping || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/admin/orders/shipping", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:selected.id,expectedStatus:selected.shipping.status,status:deliveryStatus,carrier,trackingNumber:tracking})});
      const d = await r.json(); if (!r.ok) throw new Error(d.error);
      setSelected(null); clearAdminData(); await load(); setNotice("배송 정보를 저장했습니다.");
    } catch (e) { setError(e instanceof Error ? e.message : "배송 처리 실패"); }
    finally { lock.current = false; setBusy(false); }
  }
  return (
    <main className="commerce">
      <header>
        <Link href="/admin">{tr("← 관리자 콘솔")}</Link>
        <Link href="/admin/shop">{tr("상품 관리")}</Link>
      </header>
      <p className="shop-kicker">ADMIN / ORDERS</p>
      <h1>{tr("주문 관리")}</h1>
      <p className="shop-muted">{tr("취소 승인 시 결제 자산 전액 반환과 주문 수량만큼의 재고 복구가 함께 처리됩니다.")}</p>
      <form
        className="shop-editor admin-order-filter"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          load().catch((e) => setError(e.message));
        }}
      >
        <label>{tr("주문·상품·회원 검색")}<input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={150}
          />
        </label>
        <label>{tr("주문 상태")}<select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">{tr("전체")}</option>
            {Object.entries(orderStatus).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <button>{tr("조회")}</button>
      </form>
      {tr(error) && (
        <p className="shop-error" role="alert">
          {tr(error)}
        </p>
      )}
      {tr(notice) && (
        <p className="shop-success" role="status">
          {tr(notice)}
        </p>
      )}
      <p className="shop-muted">{tr("최근 조회 결과 최대 200건")}</p>
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
              {o.id} · {tr(orderStatus[o.status])} ·{" "}
              {new Date(o.created_at).toLocaleString(localeTag, { timeZone: 'Asia/Seoul' })}
            </small>
          </div>
          <strong>
            {formatUsdt(o.total, o.currency === "POINT" ? 0 : 6)} {o.currency === "POINT" ? "P" : "USDT"}
          </strong>
          <button
            disabled={busy}
            onClick={() => {
              setSelected(o);
              setDeliveryStatus(o.shipping?.status || "preparing");
              setCarrier(o.shipping?.carrier || "");
              setTracking(o.shipping?.tracking_number || "");
              setReason("");
              setConfirmation(false);
              setNotice("");
            }}
          >{tr("주문 상세")}</button>
        </article>
      ))}
      {!orders.length && <p>{tr("조회된 주문이 없습니다.")}</p>}
      {selected && (
        <section ref={detail} className="shop-detail" aria-label={tr("주문 상세")}>
          <h2>{selected.product_name}</h2>
          <p>{tr("주문번호 ")}{selected.id}</p>
          <p>
            {selected.member_name} · {selected.email}
          </p>
          <p>
            {tr(orderStatus[selected.status])}{tr(" · 수량 ")}{selected.quantity}{tr(" · 단가")}{" "}
            {formatUsdt(selected.unit_price, selected.currency === "POINT" ? 0 : 6)}{" "}
            {selected.currency === "POINT" ? "P" : "USDT"}
          </p>
          <DetailContent
            description={selected.product_description}
            blocks={selected.product_detail_blocks}
          />
          {selected.shipping && <section className="shop-editor" aria-label={tr("배송 정보")}>
            <h3>{tr("배송 정보")}</h3>
            <p>{selected.shipping.recipient} · {selected.shipping.phone}</p>
            <p>{selected.shipping.address}</p>
            {selected.shipping.note && <p>{tr("요청사항: ")}{selected.shipping.note}</p>}
            <label>{tr("배송 상태")}<select value={deliveryStatus} disabled={busy || selected.status !== "paid"} onChange={e=>setDeliveryStatus(e.target.value as typeof deliveryStatus)}>
              <option value="preparing" disabled={selected.shipping.status !== "preparing"}>{tr("배송 준비")}</option>
              <option value="shipped" disabled={selected.shipping.status === "delivered"}>{tr("배송 중")}</option>
              <option value="delivered" disabled={selected.shipping.status === "preparing"}>{tr("배송 완료")}</option>
            </select></label>
            <label>{tr("택배사")}<input maxLength={100} value={carrier} disabled={busy || selected.status !== "paid"} onChange={e=>setCarrier(e.target.value)} /></label>
            <label>{tr("송장번호")}<input maxLength={100} value={tracking} disabled={busy || selected.status !== "paid"} onChange={e=>setTracking(e.target.value)} /></label>
            <button disabled={busy || selected.status !== "paid"} onClick={saveShipping}>{tr("배송 정보 저장")}</button>
            {selected.status !== "paid" && <p>{tr("취소 요청 또는 취소된 주문은 배송 정보를 변경할 수 없습니다.")}</p>}
          </section>}
          <p>{tr("취소 요청 사유: ")}{selected.cancellation_reason || tr("관리자 직접 취소")}
          </p>
          {selected.status === "cancelled" ? (
            <>
              <p>{tr("환불 사유: ")}{selected.refund_reason}</p>
              <p>{tr("환불 거래: ")}{selected.refund_transaction_id}</p>
            </>
          ) : (
            <>
              <label>{tr("처리 사유")}<textarea
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
                    {formatUsdt(selected.total, selected.currency === "POINT" ? 0 : 6)}{" "}
                    {selected.currency === "POINT" ? "P" : "USDT"}{tr("를 반환하고 재고 ")}{selected.quantity}{tr("개를 복구합니다.")}</p>
                  <button
                    className="shop-primary"
                    disabled={busy}
                    onClick={() => decide("approve")}
                  >
                    {busy ? tr("처리 중…") : tr("취소 승인 및 전액 환불 확정")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setConfirmation(false)}
                  >{tr("돌아가기")}</button>
                </>
              ) : (
                <>
                  <button
                    className="shop-primary"
                    disabled={busy || !reason.trim()}
                    onClick={() => setConfirmation(true)}
                  >{tr("취소 승인·환불 검토")}</button>
                  {selected.status === "cancellation_requested" && (
                    <button
                      disabled={busy || !reason.trim()}
                      onClick={() => decide("reject")}
                    >{tr("취소 요청 반려")}</button>
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
          >{tr("상세 닫기")}</button>
        </section>
      )}
    </main>
  );
}
