"use client";
import { useI18n } from "./i18n";

import { useEffect, useRef, useState } from "react";
import { formatUsdt, decimalUsdt } from "@/lib/money";
import "./shop.css";
import type { DetailBlock } from "@/lib/product-content";
import { DetailContent } from "./product-content";
import { DetailEditor, ImageUpload } from "./product-editor";
import { zeroPlan, rewardLabels, type RewardPlan } from "@/lib/marketing-plan";
type Product = {
  package_type: "none" | "lucky" | "treasure";
  shipping_type: "physical" | "none" | null;
  id: string;
  name: string;
  description: string;
  detail_blocks: DetailBlock[];
  image_url: string;
  price: string;
  retail_price?: string | null;
  stock: number;
  active: boolean;
  version: number;
  reward_plan: RewardPlan;
};
type Order = {
  shipping: { recipient: string; phone: string; address: string; note: string; status: string; carrier: string; tracking_number: string } | null;
  status: string;
  refund_reason: string;
  currency: "USDT" | "POINT";
  id: string;
  product_name: string;
  quantity: number;
  total: string;
  created_at: string;
};
async function requestJson(url: string, body?: unknown) {
  const response = await fetch(url, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (response.status === 401) {
    location.href = "/login";
    throw new Error("로그인해 주세요.");
  }
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}
function ProductImage({
  product,
}: {
  product: Pick<Product, "image_url" | "name">;
}) {
  const { tr } = useI18n();
  return product.image_url ? (
    <img
      src={product.image_url}
      alt={tr(product.name)}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : (
    <div className="shop-placeholder">
      JM<span>EVERYDAY SHOP</span>
    </div>
  );
}
function ProductPrice({ product }: { product: Pick<Product, "price" | "retail_price"> }) {
  const { tr } = useI18n();
  const display = (value: string) => formatUsdt(value, BigInt(value) % 1_000_000n === 0n ? 0 : 6);
  return (
    <div className="shop-prices">
      {product.retail_price && <span className="shop-muted">{tr("소비자가 ")}<s>{display(product.retail_price)} P</s></span>}
      <strong>{product.retail_price ? tr("회원가 ") : ""}{display(product.price)} P</strong>
    </div>
  );
}
export function Shop({ productId }: { productId?: string }) {
  const { tr, localeTag } = useI18n();
  const [products, setProducts] = useState<Product[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [available, setAvailable] = useState("0");
  const [selected, setSelected] = useState<Product | null>(null),
    [quantity, setQuantity] = useState(1),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const key = useRef("");
  const [marketing, setMarketing] = useState({
    enabled: false,
    daily_paused: false,
    version: 0,
  });
  const locked = useRef(false);
  const [shipping, setShipping] = useState({ recipient: "", phone: "", address: "", note: "" });
  async function load(openDetail = false) {
    const data = await requestJson("/api/shop");
    setProducts(data.products);
    setOrders(data.orders);
    setAvailable(data.available);
    setMarketing(
      data.marketing || { enabled: false, daily_paused: false, version: 0 },
    );
    if (productId && openDetail) {
      const product = data.products.find((p: Product) => p.id === productId);
      if (product) choose(product);
      else setError("판매 중인 상품을 찾을 수 없습니다.");
    }
  }
  useEffect(() => {
    load(true)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [productId]);
  function choose(product: Product) {
    setSelected(product);
    setQuantity(1);
    key.current = crypto.randomUUID();
    setNotice("");
    setError("");
  }
  async function purchase() {
    if (!selected || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await requestJson("/api/shop", {
        productId: selected.id,
        quantity,
        version: selected.version,
        requestKey: key.current,
        marketingVersion: marketing.version || undefined,
        shipping: selected.shipping_type === "physical" ? shipping : undefined,
      });
      setNotice(`구매가 완료되었습니다. 주문번호 ${result.id}`);
      setSelected(null);
      key.current = "";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "결제에 실패했습니다.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const total = selected ? BigInt(selected.price) * BigInt(quantity) : 0n;
  return (
    <main className="commerce">
      <header>
        <a href="/">{tr("← 내 지갑")}</a>
        <a href="/points">{tr("USDT ↔ 포인트 전환")}</a>
      </header>
      <p className="shop-kicker">JMUSDT / EVERYDAY SHOP</p>
      <h1>{tr("지갑에서 만나는")}<br />{tr("새로운 일상.")}</h1>
      <p className="shop-muted">{tr("내 포인트로 간편하게 구매하세요.")}</p>
      <div className="shop-balance">{tr("사용 가능한 잔액 ")}<strong>{formatUsdt(available, 6)}{tr(" 포인트")}</strong>
      </div>
      {tr(error) && (
        <p className="shop-error" role="alert">
          {tr(error)}{" "}
          <button
            onClick={() => {
              setError("");
              load(true).catch((e) => setError(e.message));
            }}
          >{tr("새로고침")}</button>
        </p>
      )}
      {tr(notice) && (
        <p className="shop-success" role="status">
          {tr(notice)}
        </p>
      )}
      {loading ? (
        <p>{tr("상품을 불러오는 중…")}</p>
      ) : (
        <section className="shop-grid" aria-label={tr("상품 목록")}>
          {products
            .filter(() => !productId)
            .map((p) => (
              <article className="shop-card" key={p.id}>
                <ProductImage product={p} />
                <div>
                  <h2>{tr(p.name)}</h2>
                  <p className="shop-muted">{tr("재고 ")}{p.stock}{tr("개")}</p>
                  <ProductPrice product={p} />
                  <a className="shop-primary" href={`/shop/${p.id}`}>{tr("상품 상세 보기")}</a>
                </div>
              </article>
            ))}
          {!products.length && <p>{tr("판매 중인 상품이 없습니다.")}</p>}
        </section>
      )}
      {selected && (
        <section className="shop-detail" aria-label={tr("상품 상세 및 구매 확인")}>
          <div className="shop-section-head">
            <h2>{tr(selected.name)}</h2>
            <button
              disabled={busy}
              onClick={() => {
                location.href = "/shop";
              }}
            >{tr("닫기")}</button>
          </div>
          <ProductImage product={selected} />
          <DetailContent
            description={selected.description}
            blocks={selected.detail_blocks}
          />
          <ProductPrice product={selected} />
          <p className="shop-muted">{tr("재고 ")}{selected.stock}{tr("개")}</p>
          {!marketing.enabled && (
            <p className="shop-error">{tr("현재 신규 구매의 마케팅 보상 적용이 중단되어 있습니다. 이 구매에는 추천·후원·맘 리워드와 데일리가 발생하지 않습니다. 일일 분배 적립금은 상품별로 적립됩니다.")}</p>
          )}
          {marketing.enabled && marketing.daily_paused && (
            <p className="shop-muted">{tr("데일리 지급이 일시정지 중입니다. 구매 권리는 생성되며 재개 후 기한이 지난 회차가 지급됩니다.")}</p>
          )}
          {marketing.enabled && selected.reward_plan && selected.reward_plan.days > 0 && (
            <p className="shop-muted">{tr("상품 1개당 데일리")}{" "}
              {formatUsdt(selected.reward_plan.daily, 6)} P ×{" "}
              {selected.reward_plan.days}{tr("일. 보상 운영이 켜진 구매에 적용되며 데일리는 구매 다음 날부터입니다.")}</p>
          )}
          {selected.reward_plan && <p className="shop-muted">{tr("상품 1개당 회사 적립: 복주머니P ")}{selected.reward_plan.lucky}{tr(" P · 보물상자P ")}{selected.reward_plan.treasure} P</p>}
          <label>{tr("수량")}<select aria-label={tr("수량")}
              disabled={busy}
              value={quantity}
              onChange={(e) => {
                setQuantity(Number(e.target.value));
                key.current = crypto.randomUUID();
              }}
            >
              {Array.from({ length: Math.min(99, selected.stock) }, (_, i) => (
                <option key={i + 1}>{i + 1}</option>
              ))}
            </select>
          </label>
          <div className="shop-total">{tr("결제금액 ")}<strong>{formatUsdt(total, 6)}{tr(" 포인트")}</strong>
          </div>
          {selected.shipping_type === "physical" ? <div className="shop-editor">
            <h3>{tr("배송 정보")}</h3>
            {([['recipient','받는 분',100],['phone','연락처',40],['address','배송 주소',500],['note','배송 요청사항 (선택)',500]] as const).map(([field,label,max]) => <label key={field}>{tr(label)}<input maxLength={max} value={shipping[field]} disabled={busy} onChange={(e) => { setShipping({...shipping,[field]:e.target.value}); key.current = crypto.randomUUID(); }} /></label>)}
          </div> : <p>{tr("배송이 필요 없는 상품입니다.")}</p>}
          <p className="shop-muted">{tr("결제 확정 시 지갑 잔액에서 차감됩니다. 상품·가격이 변경되면 결제가 중단됩니다.")}</p>
          <button
            className="shop-primary"
            disabled={
              busy || selected.stock < quantity || BigInt(available) < total || (selected.shipping_type === "physical" && (!shipping.recipient.trim() || !shipping.phone.trim() || !shipping.address.trim()))
            }
            onClick={purchase}
          >
            {busy
              ? tr("결제 확인 중…")
              : selected.stock === 0
                ? tr("품절")
                : BigInt(available) < total
                  ? tr("포인트 잔액 부족")
                  : tr("{0} 포인트 결제 확정", {"0": formatUsdt(total, 6)})}
          </button>
        </section>
      )}
      <section id="orders">
        <h2>{tr("구매 내역")}</h2>
        {orders.map((o) => (
          <article className="shop-order" key={o.id}>
            <div>
              <strong>
                {tr(o.product_name)} × {o.quantity}
              </strong>
              <p className="shop-muted">
                {new Date(o.created_at).toLocaleString(localeTag, { timeZone: 'Asia/Seoul' })} ·{" "}
                {o.status === "cancelled"
                  ? tr("취소·환불 완료")
                  : o.status === "cancellation_requested"
                    ? tr("취소 승인 대기")
                    : tr("결제 완료")}
              </p>
              <small>{tr("주문번호 ")}{o.id}</small>
              {o.shipping && <div><p>{tr("배송: ")}{tr(({preparing: "배송 준비", shipped: "배송 중", delivered: "배송 완료"} as Record<string,string>)[o.shipping.status])}</p><p>{tr("받는 분: ")}{o.shipping.recipient} · {o.shipping.phone}</p><p>{tr("주소: ")}{o.shipping.address}</p>{o.shipping.note && <p>{tr("요청사항: ")}{o.shipping.note}</p>}{o.shipping.tracking_number && <p>{o.shipping.carrier} · {o.shipping.tracking_number}</p>}</div>}
              {o.status === "cancelled" && <p>{tr("환불 사유: ")}{o.refund_reason}</p>}
              {o.status === "paid" && (
                <CancelOrder orderId={o.id} onDone={load} />
              )}
            </div>
            <strong>
              {formatUsdt(o.total, 6)} {o.currency === "USDT" ? "USDT" : "P"}
            </strong>
          </article>
        ))}
        {!orders.length && (
          <p className="shop-muted">{tr("아직 구매 내역이 없습니다.")}</p>
        )}
      </section>
    </main>
  );
}
function CancelOrder({
  orderId,
  onDone,
}: {
  orderId: string;
  onDone: () => Promise<void>;
}) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return open ? (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          await requestJson("/api/orders/cancel", { orderId, reason });
          await onDone();
        } catch (e) {
          setError(e instanceof Error ? e.message : "취소 요청 실패");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>{tr("취소 요청 사유")}<input
          required
          maxLength={500}
          disabled={busy}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <p className="shop-muted">{tr("관리자 승인 후 결제 자산으로 전액 환불됩니다.")}</p>
      {tr(error) && <p role="alert">{tr(error)}</p>}
      <button disabled={busy || !reason.trim()}>
        {busy ? tr("요청 중…") : tr("취소 요청 제출")}
      </button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)}>{tr("닫기")}</button>
    </form>
  ) : (
    <button onClick={() => setOpen(true)}>{tr("취소 요청")}</button>
  );
}
const empty = {
  packageType: "none" as "none" | "lucky" | "treasure",
  shippingType: "" as "" | "physical" | "none",
  name: "",
  description: "",
  imageUrl: "",
  price: "",
  retailPrice: "",
  stock: 0,
  active: false,
  detailBlocks: [] as DetailBlock[],
  rewardPlan: zeroPlan,
};
export function ProductAdmin() {
  const { tr } = useI18n();
  const [products, setProducts] = useState<Product[]>([]),
    [form, setForm] = useState<{
      id?: string;
      version?: number;
      name: string;
      description: string;
      detailBlocks: DetailBlock[];
      imageUrl: string;
      price: string;
      retailPrice: string;
      stock: number;
      active: boolean;
      shippingType: "" | "physical" | "none";
      packageType: "none" | "lucky" | "treasure";
      rewardPlan: RewardPlan;
    }>(empty);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false),
    [mobilePreview, setMobilePreview] = useState(true);
  async function load() {
    setProducts((await requestJson("/api/admin/products")).products);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || uploading) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await requestJson("/api/admin/products", form);
      setForm(empty);
      await load();
      setNotice("상품을 저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="commerce">
      <header>
        <a href="/admin">{tr("← 관리자 콘솔")}</a>
        <a href="/shop">{tr("쇼핑몰 보기 ↗")}</a>
        <a href="/admin/marketing">{tr("마케팅 관리")}</a>
      </header>
      <p className="shop-kicker">ADMIN / COMMERCE</p>
      <h1>{tr("상품 관리")}</h1>
      <p className="shop-muted">{tr("상품과 상세 설명을 등록하고 포인트 가격으로 판매하세요.")}</p>
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
      <div className="shop-admin-grid">
        <form className="shop-editor" onSubmit={save}>
          <h2>{form.id ? tr("상품 수정") : tr("새 상품 등록")}</h2>
          <fieldset disabled={busy || uploading}>
            <label>{tr("상품명")}<input
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>{tr("대표 이미지 HTTPS 주소")}<input
                type="url"
                placeholder="https://…"
                value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              />
            </label>
            <ImageUpload
              label="대표 이미지 직접 업로드"
              onBusy={setUploading}
              onUploaded={(url) =>
                setForm((current) => ({ ...current, imageUrl: url }))
              }
            />
            {form.imageUrl && (
              <>
                <img
                  className="product-editor-thumb"
                  src={form.imageUrl}
                  alt={tr("대표 이미지 미리보기")}
                  referrerPolicy="no-referrer"
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, imageUrl: "" })}
                >{tr("대표 이미지 제거")}</button>
              </>
            )}
            <label>{tr("상품 요약 설명")}<textarea
                rows={10}
                maxLength={20000}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <small className="shop-muted">{tr("줄바꿈이 유지됩니다. HTML·스크립트는 실행되지 않습니다.")}</small>
            <DetailEditor
              blocks={form.detailBlocks}
              onBusy={setUploading}
              onChange={(detailBlocks) =>
                setForm((current) => ({ ...current, detailBlocks }))
              }
            />
            <label>{tr("회원가 (실제 결제가 · P)")}<input
                required
                inputMode="decimal"
                placeholder="10.000000"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </label>
            <label>{tr("소비자가 (비교 표시 · P · 선택)")}<input
                inputMode="decimal"
                placeholder={tr("회원가 이상, 비우면 표시하지 않음")}
                value={form.retailPrice}
                onChange={(e) => setForm({ ...form, retailPrice: e.target.value })}
              />
            </label>
            <label>{tr("재고 수량")}<input
                required
                type="number"
                min={0}
                max={1000000}
                step={1}
                value={form.stock}
                onChange={(e) =>
                  setForm({ ...form, stock: Number(e.target.value) })
                }
              />
            </label>
            <label>{tr("배송 유형")}<select required value={form.shippingType} onChange={(e) => setForm({...form, shippingType:e.target.value as typeof form.shippingType})}>
                <option value="">{tr("유형을 선택하세요")}</option>
                <option value="physical">{tr("실물 배송")}</option>
                <option value="none">{tr("배송 불필요")}</option>
              </select>
            </label>
            <label>{tr("일일 분배 패키지")}<select value={form.packageType} onChange={(e) => setForm({...form,packageType:e.target.value as typeof form.packageType})}>
                <option value="none">{tr("일반 상품")}</option>
                <option value="lucky">{tr("복주머니패키지 · 350,000 P")}</option>
                <option value="treasure">{tr("보물상자패키지 · 3,500,000 P")}</option>
              </select>
            </label>
            <section className="shop-editor" aria-label={tr("상품별 마케팅 보상")}>
              <h3>{tr("상품 1개당 마케팅 보상")}</h3>
              <p className="shop-muted">{tr("고정 포인트를 입력하세요. 0은 미지급입니다. 추천인·후원인·후원인의 추천인에게 지급하며, 맘은 후원리워드가 지급될 때만 발생합니다. 보상 총액은 상품 가격 이하여야 합니다. 복주머니 1,000 P·보물상자 10,000 P × 369일 데일리 전용 플랜은 예외입니다. 이 경우 다른 리워드·회사 적립은 모두 0이어야 합니다. 변경은 이후 구매에만 적용됩니다.")}</p>
              {(["referral", "sponsor", "mom", "daily"] as const).map((key) => (
                <label key={key}>
                  {tr(rewardLabels[key])} ({key === "daily" ? tr("하루 P") : "P"})
                  <input
                    required
                    inputMode="decimal"
                    value={form.rewardPlan[key]}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        rewardPlan: {
                          ...form.rewardPlan,
                          [key]: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              ))}
              <label>{tr("데일리 지급 일수 (최대 369일)")}<input
                  required
                  type="number"
                  min={0}
                  max={369}
                  value={form.rewardPlan.days}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      rewardPlan: {
                        ...form.rewardPlan,
                        days: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              {(["lucky", "treasure"] as const).map((key) => (
                <label key={key}>{tr("회사 ")}{tr(rewardLabels[key])}{tr(" 적립 (정수 P)")}<input
                    required
                    type="number"
                    min={0}
                    max={1000000}
                    value={form.rewardPlan[key]}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        rewardPlan: {
                          ...form.rewardPlan,
                          [key]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
              <small>{tr("판매 시 회사에 적립하고 일일 마감 후 해당 패키지 보유 수량에 따라 일반 포인트로 분배합니다.")}</small>
            </section>
            <label className="shop-check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />{tr("판매 중 (해제하면 비공개)")}</label>
            <button className="shop-primary" type="submit">
              {busy ? tr("저장 중…") : tr("상품 저장")}
            </button>
            <button type="button" onClick={() => setForm(empty)}>{tr("새 상품 작성")}</button>
          </fieldset>
        </form>
        <section>
          <div className="shop-section-head">
            <h2>{tr("저장 전 미리보기")}</h2>
            <button
              type="button"
              onClick={() => setMobilePreview(!mobilePreview)}
            >
              {mobilePreview ? tr("넓게 보기") : tr("모바일 보기")}
            </button>
          </div>
          <p className="shop-muted">{tr("아래 미리보기는 편집 중인 내용입니다. 상품 저장 후 쇼핑몰에 반영됩니다.")}</p>
          <div
            className={`product-preview ${mobilePreview ? "mobile-preview" : ""}`}
            aria-label={tr("상품 상세 미리보기")}
          >
            <ProductImage
              product={{
                name: form.name || "상품명",
                image_url: form.imageUrl,
              }}
            />
            <h2>{form.name || tr("상품명을 입력하세요")}</h2>
            <div className="shop-prices">
              {form.retailPrice && <span className="shop-muted">{tr("소비자가 ")}<s>{form.retailPrice} P</s></span>}
              <strong>{form.retailPrice ? tr("회원가 ") : ""}{form.price || "0"} P</strong>
            </div>
            <p className="shop-muted">
              {form.active ? tr("판매 중으로 저장") : tr("비공개로 저장")}{tr(" · 재고")}{" "}
              {form.stock}{tr("개")}</p>
            <DetailContent
              description={form.description}
              blocks={form.detailBlocks}
            />
          </div>
          <h2>{tr("등록 상품 (")}{products.length})</h2>
          {products.map((p) => (
            <article className="shop-order" key={p.id}>
              <div>
                <strong>{tr(p.name)}</strong>
                <ProductPrice product={p} />
                <p>{tr("재고 ")}{p.stock}{tr("개")}</p>
                <small>
                  {p.active ? tr("판매 중") : tr("비공개")}{tr(" · 버전 ")}{p.version}
                  {" · "}{p.shipping_type === "physical" ? tr("실물 배송") : p.shipping_type === "none" ? tr("배송 불필요") : tr("배송 유형 확인 필요 — 판매 목록에서 제외")}
                </small>
              </div>
              <button
                disabled={busy || uploading}
                onClick={() => {
                  setForm({
                    id: p.id,
                    version: p.version,
                    name: p.name,
                    description: p.description,
                    detailBlocks: p.detail_blocks || [],
                    imageUrl: p.image_url,
                    price: decimalUsdt(BigInt(p.price)),
                    retailPrice: p.retail_price == null ? "" : decimalUsdt(BigInt(p.retail_price)),
                    stock: p.stock,
                    active: p.active,
                    shippingType: p.shipping_type || "",
                    packageType: p.package_type || "none",
                    rewardPlan: {
                      ...(p.reward_plan || zeroPlan),
                      ...Object.fromEntries(
                        (["referral", "sponsor", "mom", "daily"] as const).map(
                          (k) => [
                            k,
                            decimalUsdt(BigInt(p.reward_plan?.[k] || "0")),
                          ],
                        ),
                      ),
                    },
                  });
                  setNotice("");
                }}
              >{tr("수정")}</button>
            </article>
          ))}
          {!products.length && (
            <p className="shop-muted">{tr("첫 상품을 등록해 주세요.")}</p>
          )}
        </section>
      </div>
    </main>
  );
}
