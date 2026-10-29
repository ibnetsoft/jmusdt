"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { clearPreloadedData } from "@/lib/preload-pages";
import { BottomNav } from "./bottom-nav";
import { formatUsdt } from "@/lib/money";
import "./shop.css";

type Product = { id: string; name: string; image_url: string; price: string; stock: number; version: number; shipping_type: "physical" | "none" };
type Shipping = { recipient: string; phone: string; address: string; note: string };
type Item = { productId: string; quantity: number; version: number; requestKey: string; marketingVersion?: number; shipping?: Shipping };
type Pending = { userId: string; items: Item[] };
const pendingKey = "jmusdt-cart-checkout-pending";
export function CartCheckout() {
  const { tr } = useI18n();
  const [products, setProducts] = useState<Product[]>([]), [ids, setIds] = useState<string[]>([]), [quantities, setQuantities] = useState<Record<string, number>>({}), [available, setAvailable] = useState("0"), [marketingVersion, setMarketingVersion] = useState<number | undefined>(), [marketing, setMarketing] = useState<{enabled: boolean; daily_paused: boolean} | null>(null), [userId, setUserId] = useState(""), [shipping, setShipping] = useState<Shipping>({recipient:"",phone:"",address:"",note:""}), [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [done, setDone] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    try {
      const saved = JSON.parse(localStorage.getItem("jmusdt-cart") || "[]");
      if (Array.isArray(saved)) setIds([...new Set(saved.filter((id): id is string => typeof id === "string"))]);
      const previous = sessionStorage.getItem(pendingKey);
      if (previous) setPending(JSON.parse(previous));
    } catch { setError("장바구니를 불러오지 못했습니다."); }
    Promise.all([fetch("/api/shop", {cache:"no-store", signal:controller.signal}), fetch("/api/wallet", {cache:"no-store", signal:controller.signal})]).then(async ([r, wallet]) => {
      if (r.status === 401 || wallet.status === 401) { location.href="/login"; return; }
      const [data, account] = await Promise.all([r.json(), wallet.json()]); if (!r.ok || !wallet.ok) throw new Error(data.error || account.error);
      setProducts(data.products); setAvailable(data.available); setMarketingVersion(data.marketing?.version); setMarketing(data.marketing); setUserId(account.user.id);
    }).catch(e => {if (e.name !== "AbortError") setError(e.message || "상품을 불러오지 못했습니다.");}).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, []);
  const items = ids.map(id => products.find(p => p.id === id));
  const missing = items.some(p => !p);
  const total = items.reduce((sum, p) => sum + (p ? BigInt(p.price) * BigInt(quantities[p.id] || 1) : 0n), 0n);
  const physical = items.some(p => p?.shipping_type === "physical");
  const fractionalPrice = items.some(p => p && BigInt(p.price) % 1000000n !== 0n);
  const wrongUser = !!pending && pending.userId !== userId;
  const shippingValid = !physical || !!(shipping.recipient.trim() && shipping.phone.trim() && shipping.address.trim());
  function remove(id: string) { const next = ids.filter(value => value !== id); try {localStorage.setItem("jmusdt-cart", JSON.stringify(next)); setIds(next);} catch {setError("장바구니를 저장하지 못했습니다.");} }
  async function checkout() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const body: Pending = pending || { userId, items: items.map(p => ({productId:p!.id, quantity:quantities[p!.id] || 1, version:p!.version, requestKey:crypto.randomUUID(), marketingVersion, ...(p!.shipping_type === "physical" ? {shipping} : {})})) };
      if (!pending) { sessionStorage.setItem(pendingKey, JSON.stringify(body)); setPending(body); }
      const response = await fetch("/api/shop/checkout", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({items:body.items})});
      const result = await response.json();
      if (!response.ok) { if (response.status >= 400 && response.status < 500) {sessionStorage.removeItem(pendingKey); setPending(null);} throw new Error(result.error || "결제에 실패했습니다."); }
      clearPreloadedData();
      const purchased = new Set(body.items.map(item => item.productId));
      const remaining = ids.filter(id => !purchased.has(id));
      localStorage.setItem("jmusdt-cart", JSON.stringify(remaining)); sessionStorage.removeItem(pendingKey); setPending(null); setIds(remaining); setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "결제에 실패했습니다."); }
    finally {lock.current = false; setBusy(false);}
  }
  return <><main className="commerce cart-checkout" aria-label={tr("장바구니 결제")}>
    <header><a href="/shop">{tr("← 쇼핑몰")}</a></header>
    <h1>{tr("장바구니 결제")}</h1>
    {loading && <p role="status">{tr("상품을 불러오는 중…")}</p>}
    {done && <p className="shop-success" role="status">{tr("장바구니 결제가 완료되었습니다.")}</p>}
    {error && <p className="shop-error" role="alert">{tr(error)}</p>}
    {pending && <p role="status">{tr("결제 결과를 확인할 수 없습니다. 같은 요청으로 다시 확인해 주세요.")}</p>}
    {!loading && ids.length === 0 && !pending && <p>{tr("장바구니가 비어 있습니다.")}</p>}
    {!loading && ids.length > 0 && <>
      {marketing && !marketing.enabled && <p className="shop-error">{tr("현재 신규 구매의 마케팅 보상 적용이 중단되어 있습니다. 이 구매에는 추천·후원·맘 리워드와 데일리가 발생하지 않습니다. 일일 분배 적립금은 상품별로 적립됩니다.")}</p>}
      {marketing?.enabled && marketing.daily_paused && <p>{tr("데일리 지급이 일시정지 중입니다. 구매 권리는 생성되며 재개 후 기한이 지난 회차가 지급됩니다.")}</p>}
      {items.map((p, index) => <article className="checkout-item" key={ids[index]}>
        {p ? <>{p.image_url ? <img className="checkout-thumbnail" src={p.image_url} alt="" referrerPolicy="no-referrer" /> : <span className="checkout-thumbnail checkout-thumbnail-placeholder" aria-hidden="true">WU</span>}<div><strong>{tr(p.name)}</strong><p>{formatUsdt(p.price, 0)} P</p></div><label>{tr("수량")}<select value={quantities[p.id] || 1} disabled={busy || !!pending || p.stock < 1} onChange={e => setQuantities({...quantities,[p.id]:Number(e.target.value)})}>{Array.from({length:Math.min(99,p.stock)},(_,i)=><option key={i+1}>{i+1}</option>)}</select></label></> : <span>{tr("판매 중인 상품을 찾을 수 없습니다.")}</span>}
        <button type="button" disabled={busy || !!pending} onClick={() => remove(ids[index])}>{tr("삭제")}</button>
      </article>)}
      {physical && <section className="checkout-shipping"><h2>{tr("배송 정보")}</h2>{([ ["recipient","받는 분",100], ["phone","연락처",40], ["address","배송 주소",500], ["note","배송 요청사항 (선택)",500] ] as const).map(([field,label,max]) => <label key={field}>{tr(label)}<input maxLength={max} value={shipping[field]} disabled={busy || !!pending} onChange={e=>setShipping({...shipping,[field]:e.target.value})} /></label>)}</section>}
      <div className="shop-total"><span>{tr("결제금액")}</span><strong>{formatUsdt(total, 0)} P</strong></div>
      <p>{tr("보유 포인트")} {formatUsdt(available, 0)} P</p>
    </>}
    {(ids.length > 0 || pending) && <button className="shop-primary" disabled={busy || loading || !userId || wrongUser || (!pending && (fractionalPrice || missing || !shippingValid || items.some(p=>!p || p.stock < (quantities[p.id] || 1)) || total > BigInt(available)))} onClick={checkout}>{busy ? tr("결제 확인 중…") : pending ? tr("결제 다시 확인") : tr("포인트 결제")}</button>}
    {wrongUser && <p role="alert">{tr("결제를 요청한 계정으로 로그인해 주세요.")}</p>}
    {fractionalPrice && !pending && <p role="alert">{tr("상품 가격을 확인할 수 없습니다. 관리자에게 문의해 주세요.")}</p>}
    {!pending && !loading && ids.length > 0 && total > BigInt(available) && <p role="status">{tr("포인트 잔액 부족")}</p>}
  </main><BottomNav active="shop" /></>;
}
