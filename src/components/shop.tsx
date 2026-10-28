"use client";
import { useEffect, useRef, useState } from "react";
import { formatUsdt, decimalUsdt } from "@/lib/money";
import "./shop.css";
import type { DetailBlock } from "@/lib/product-content";
import { DetailContent } from "./product-content";
import { DetailEditor, ImageUpload } from "./product-editor";
type Product = {
  id: string;
  name: string;
  description: string;
  detail_blocks: DetailBlock[];
  image_url: string;
  price: string;
  stock: number;
  active: boolean;
  version: number;
};
type Order = {
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
  return product.image_url ? (
    <img
      src={product.image_url}
      alt={product.name}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  ) : (
    <div className="shop-placeholder">
      JM<span>EVERYDAY SHOP</span>
    </div>
  );
}
export function Shop({ productId }: { productId?: string }) {
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
  const locked = useRef(false);
  async function load(openDetail = false) {
    const data = await requestJson("/api/shop");
    setProducts(data.products);
    setOrders(data.orders);
    setAvailable(data.available);
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
        <a href="/">← 내 지갑</a>
        <a href="/points">USDT ↔ 포인트 전환</a>
      </header>
      <p className="shop-kicker">JMUSDT / EVERYDAY SHOP</p>
      <h1>
        지갑에서 만나는
        <br />
        새로운 일상.
      </h1>
      <p className="shop-muted">내 포인트로 간편하게 구매하세요.</p>
      <div className="shop-balance">
        사용 가능한 잔액 <strong>{formatUsdt(available, 6)} 포인트</strong>
      </div>
      {error && (
        <p className="shop-error" role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setError("");
              load(true).catch((e) => setError(e.message));
            }}
          >
            새로고침
          </button>
        </p>
      )}
      {notice && (
        <p className="shop-success" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p>상품을 불러오는 중…</p>
      ) : (
        <section className="shop-grid" aria-label="상품 목록">
          {products
            .filter(() => !productId)
            .map((p) => (
              <article className="shop-card" key={p.id}>
                <ProductImage product={p} />
                <div>
                  <h2>{p.name}</h2>
                  <p className="shop-muted">재고 {p.stock}개</p>
                  <strong>{formatUsdt(p.price, 6)} 포인트</strong>
                  <a className="shop-primary" href={`/shop/${p.id}`}>
                    상품 상세 보기
                  </a>
                </div>
              </article>
            ))}
          {!products.length && <p>판매 중인 상품이 없습니다.</p>}
        </section>
      )}
      {selected && (
        <section className="shop-detail" aria-label="상품 상세 및 구매 확인">
          <div className="shop-section-head">
            <h2>{selected.name}</h2>
            <button
              disabled={busy}
              onClick={() => {
                location.href = "/shop";
              }}
            >
              닫기
            </button>
          </div>
          <ProductImage product={selected} />
          <DetailContent
            description={selected.description}
            blocks={selected.detail_blocks}
          />
          <p>
            단가 {formatUsdt(selected.price, 6)} 포인트 · 재고 {selected.stock}
            개
          </p>
          <label>
            수량
            <select
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
          <div className="shop-total">
            결제금액 <strong>{formatUsdt(total, 6)} 포인트</strong>
          </div>
          <p className="shop-muted">
            결제 확정 시 지갑 잔액에서 차감됩니다. 상품·가격이 변경되면 결제가
            중단됩니다.
          </p>
          <button
            className="shop-primary"
            disabled={
              busy || selected.stock < quantity || BigInt(available) < total
            }
            onClick={purchase}
          >
            {busy
              ? "결제 확인 중…"
              : selected.stock === 0
                ? "품절"
                : BigInt(available) < total
                  ? "포인트 잔액 부족"
                  : `${formatUsdt(total, 6)} 포인트 결제 확정`}
          </button>
        </section>
      )}
      <section id="orders">
        <h2>구매 내역</h2>
        {orders.map((o) => (
          <article className="shop-order" key={o.id}>
            <div>
              <strong>
                {o.product_name} × {o.quantity}
              </strong>
              <p className="shop-muted">
                {new Date(o.created_at).toLocaleString("ko-KR")} ·{" "}
                {o.status === "cancelled"
                  ? "취소·환불 완료"
                  : o.status === "cancellation_requested"
                    ? "취소 승인 대기"
                    : "결제 완료"}
              </p>
              <small>주문번호 {o.id}</small>
              {o.status === "cancelled" && <p>환불 사유: {o.refund_reason}</p>}
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
          <p className="shop-muted">아직 구매 내역이 없습니다.</p>
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
      <label>
        취소 요청 사유
        <input
          required
          maxLength={500}
          disabled={busy}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <p className="shop-muted">
        관리자 승인 후 결제 자산으로 전액 환불됩니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !reason.trim()}>
        {busy ? "요청 중…" : "취소 요청 제출"}
      </button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)}>
        닫기
      </button>
    </form>
  ) : (
    <button onClick={() => setOpen(true)}>취소 요청</button>
  );
}
const empty = {
  name: "",
  description: "",
  imageUrl: "",
  price: "",
  stock: 0,
  active: false,
  detailBlocks: [] as DetailBlock[],
};
export function ProductAdmin() {
  const [products, setProducts] = useState<Product[]>([]),
    [form, setForm] = useState<{
      id?: string;
      version?: number;
      name: string;
      description: string;
      detailBlocks: DetailBlock[];
      imageUrl: string;
      price: string;
      stock: number;
      active: boolean;
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
        <a href="/admin">← 관리자 콘솔</a>
        <a href="/shop">쇼핑몰 보기 ↗</a>
      </header>
      <p className="shop-kicker">ADMIN / COMMERCE</p>
      <h1>상품 관리</h1>
      <p className="shop-muted">
        상품과 상세 설명을 등록하고 포인트 가격으로 판매하세요.
      </p>
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
      <div className="shop-admin-grid">
        <form className="shop-editor" onSubmit={save}>
          <h2>{form.id ? "상품 수정" : "새 상품 등록"}</h2>
          <fieldset disabled={busy || uploading}>
            <label>
              상품명
              <input
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              대표 이미지 HTTPS 주소
              <input
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
                  alt="대표 이미지 미리보기"
                  referrerPolicy="no-referrer"
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, imageUrl: "" })}
                >
                  대표 이미지 제거
                </button>
              </>
            )}
            <label>
              상품 요약 설명
              <textarea
                rows={10}
                maxLength={20000}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <small className="shop-muted">
              줄바꿈이 유지됩니다. HTML·스크립트는 실행되지 않습니다.
            </small>
            <DetailEditor
              blocks={form.detailBlocks}
              onBusy={setUploading}
              onChange={(detailBlocks) =>
                setForm((current) => ({ ...current, detailBlocks }))
              }
            />
            <label>
              가격 (포인트)
              <input
                required
                inputMode="decimal"
                placeholder="10.000000"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </label>
            <label>
              재고 수량
              <input
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
            <label className="shop-check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              판매 중 (해제하면 비공개)
            </label>
            <button className="shop-primary" type="submit">
              {busy ? "저장 중…" : "상품 저장"}
            </button>
            <button type="button" onClick={() => setForm(empty)}>
              새 상품 작성
            </button>
          </fieldset>
        </form>
        <section>
          <div className="shop-section-head">
            <h2>저장 전 미리보기</h2>
            <button
              type="button"
              onClick={() => setMobilePreview(!mobilePreview)}
            >
              {mobilePreview ? "넓게 보기" : "모바일 보기"}
            </button>
          </div>
          <p className="shop-muted">
            아래 미리보기는 편집 중인 내용입니다. 상품 저장 후 쇼핑몰에
            반영됩니다.
          </p>
          <div
            className={`product-preview ${mobilePreview ? "mobile-preview" : ""}`}
            aria-label="상품 상세 미리보기"
          >
            <ProductImage
              product={{
                name: form.name || "상품명",
                image_url: form.imageUrl,
              }}
            />
            <h2>{form.name || "상품명을 입력하세요"}</h2>
            <strong>{form.price || "0"} P</strong>
            <p className="shop-muted">
              {form.active ? "판매 중으로 저장" : "비공개로 저장"} · 재고{" "}
              {form.stock}개
            </p>
            <DetailContent
              description={form.description}
              blocks={form.detailBlocks}
            />
          </div>
          <h2>등록 상품 ({products.length})</h2>
          {products.map((p) => (
            <article className="shop-order" key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <p>
                  {formatUsdt(p.price, 6)} 포인트 · 재고 {p.stock}
                </p>
                <small>
                  {p.active ? "판매 중" : "비공개"} · 버전 {p.version}
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
                    stock: p.stock,
                    active: p.active,
                  });
                  setNotice("");
                }}
              >
                수정
              </button>
            </article>
          ))}
          {!products.length && (
            <p className="shop-muted">첫 상품을 등록해 주세요.</p>
          )}
        </section>
      </div>
    </main>
  );
}
