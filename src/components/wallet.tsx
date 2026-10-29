"use client";
import { useI18n } from "./i18n";
import { useRouter } from "next/navigation";
import { cacheWalletData, clearPreloadedData, preloadPages, readPreloadedData } from "@/lib/preload-pages";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  House,
  Network,
  ShoppingBag,
  Award,
  ArrowLeftRight,
  History,
  Settings,
  Wallet as WalletIcon,
  Copy,
  ShieldCheck,
  ChevronRight,
  Globe,
  LogOut,
  Eye,
  EyeOff,
  Plus,
  Check,
  X,
  Download,
  ExternalLink,
} from "lucide-react";
import type { WalletData, Transaction } from "@/lib/types";
import { demoSnapshot, demoSend, resetDemo } from "@/lib/demo-store";
import { parseUsdt, formatUsdt, decimalUsdt } from "@/lib/money";
import {
  ActivityList,
  Brand,
  Token,
  TransactionModal,
} from "./shared";
import { SiteControls } from "./site-controls";
import { CancelOrder } from "./shop";
import { BottomNav } from "./bottom-nav";
import { LuckyBagIcon, TreasureChestIcon } from "./asset-icons";
import { SecuritySettings } from "./security";
type View = "home" | "deposit" | "send" | "activity" | "settings";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export function WalletApp({initialView = "home"}: {initialView?: View}) {
  const { tr } = useI18n();
  const router = useRouter();
  const [data, setData] = useState<WalletData | null>(null),
    [fresh, setFresh] = useState(false),
    [view, setView] = useState<View>(initialView),
    [sendKind, setSendKind] = useState<"internal" | "external">("internal"),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [hidden, setHidden] = useState(false),
    [selected, setSelected] = useState<Transaction | null>(null),
    [install, setInstall] = useState<InstallEvent | null>(null);
  const latestLoaded = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/wallet", { cache: "no-store" });
      const body = await response.json();
      if (response.status === 401) {
        location.href = "/login";
        return;
      }
      if (!response.ok) throw new Error(body.error);
      latestLoaded.current = true;
      setData(body.mode === "demo" ? demoSnapshot() : body);
      setFresh(true);
      if (body.mode !== "demo") { void cacheWalletData(body); void preloadPages(); }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "지갑을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    void readPreloadedData<WalletData>("/api/wallet").then(cached => {
      if (mounted && cached && !latestLoaded.current) setData(cached);
    });
    void refresh();
    const update = () => void refresh();
    window.addEventListener("jmusdt-demo", update);
    window.addEventListener("storage", update);
    const timer = setInterval(update, 30000);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener("jmusdt-demo", update);
      window.removeEventListener("storage", update);
    };
  }, [refresh]);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js");
    const handler = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  async function logout() {
    clearPreloadedData();
    if (data?.mode === "demo") {
      location.href = "/login";
      return;
    }
    await fetch("/api/auth", { method: "DELETE" });
    location.href = "/login";
  }
  const nav = [
    { view: "home" as View, label: "내 지갑", icon: House },
    { view: "activity" as View, label: "거래 내역", icon: History },
    { view: "settings" as View, label: "마이페이지", icon: Settings },
  ];
  return (
    <div className={`wallet-layout ${view === "send" ? "wallet-layout-send" : ""}`}>
      <aside className="wallet-sidebar">
        <Brand />
        <div className="sidebar-description">
          Your money.
          <br />
          Your everyday.
        </div>
        <nav aria-label={tr("주 메뉴")}>
          <button
            onClick={() => {
              router.push("/rewards");
            }}
          >{tr("리워드 · 주머니")}</button>
          <button
            onClick={() => {
              router.push("/organization");
            }}
          >{tr("추천 · 후원 조직도")}</button>
          <button
            onClick={() => {
              router.push("/points");
            }}
          >{tr("포인트 전환")}</button>
          {nav.map((n) => (
            <button
              key={n.view}
              className={view === n.view ? "active" : ""}
              onClick={() => setView(n.view)}
            >
              <n.icon size={20} />
              {tr(n.label)}
              {view === n.view ? <span className="nav-dot" /> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="network-pill">
            <i />
            TRON NETWORK
          </span>
          <p>{tr("심플하게 보내고,")}<br />{tr("안전하게 보관하세요.")}</p>
          <a href="/admin">{tr("관리자 콘솔 ")}<ExternalLink size={14} />
          </a>
        </div>
      </aside>
      <main className="wallet-main">
        <header className="wallet-header">
          <div className="mobile-brand">
            <Brand />
          </div>
          <span className="desktop-only eyebrow">PERSONAL WALLET</span>

        </header>
        {data?.mode === "demo" ? (
          <div className="demo-strip">
            <span>
              <i /> DEMO</span>
            <a href="/login">{tr("계정 연결 ")}<ArrowUpRight size={12} />
            </a>
          </div>
        ) : null}
        {error ? (
          <div className="error-banner" role="alert">
            {tr(error)}
            <button onClick={() => void refresh()}>{tr("다시 시도")}</button>
          </div>
        ) : null}
        {data ? (
          <>
            {view === "home" ? (
              <>
                <section className="balance-card wallet-assets">
                  <div className="balance-title"><span>USDT</span><button aria-label={hidden ? tr("잔액 표시") : tr("잔액 숨기기")} onClick={() => setHidden(!hidden)}>{hidden ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
                  <div className="asset-value">{hidden ? "••••••" : formatUsdt(data.available, 6)} <small>USDT</small></div>
                  <div className="asset-label">{tr("포인트")}</div>
                  <div className="asset-value">{hidden ? "••••••" : formatUsdt(data.points || "0", 0)} <small>P</small></div>
                  <div className="asset-meta">
                    <span title={tr("회원등급")}><Award size={18} aria-label={tr("회원등급")} />{tr(data.user.gradeName || "일반회원")}</span>
                    <span title={tr("복주머니")}><LuckyBagIcon label={tr("복주머니")} />{data.packages?.lucky ?? "0"}</span>
                    <span title={tr("보물상자")}><TreasureChestIcon label={tr("보물상자")} />{data.packages?.treasure ?? "0"}</span>
                  </div>
                </section>
                <div className="quick-actions">
                  <button disabled={!fresh} onClick={() => setView("deposit")}><ArrowDownLeft size={20} />{tr("입금")}</button>
                  <button disabled={!fresh} onClick={() => { setSendKind("internal"); setView("send"); }}><ArrowUpRight size={20} />{tr("이체")}</button>
                  <button onClick={() => { router.push("/points"); }}><ArrowLeftRight size={20} />{tr("스왑")}</button>
                  <button disabled={!fresh} onClick={() => { setSendKind("external"); setView("send"); }}><ExternalLink size={20} />{tr("출금")}</button>
                </div>
                <div className="section-heading">
                  <h2>{tr("최근 거래")}</h2>
                  <button onClick={() => setView("activity")}>{tr("전체 보기 ")}<ChevronRight size={15} />
                  </button>
                </div>
                <ActivityList
                  transactions={data.transactions.slice(0, 4)}
                  onSelect={setSelected}
                />
              </>
            ) : null}
            {view === "deposit" && fresh ? (
              <Deposit
                data={data}
                onUpdate={refresh}
                notify={setToast}
              />
            ) : null}
            {view === "send" && fresh ? (
              <Send
                initialKind={sendKind}
                data={data}
                onBack={() => setView("home")}
                onUpdate={refresh}
              />
            ) : null}
            {view === "activity" ? (
              <Activity data={data} onSelect={setSelected} />
            ) : null}
            {view === "settings" ? (
              <>
                <section className="settings-profile">
                  <span className="profile-avatar large">
                    {data.user.name.slice(0, 1)}
                  </span>
                  <h2>{data.user.name}</h2>
                  <p>{data.user.email}</p>
                  {tr(data.user.gradeName) && <p>{tr("회원등급: ")}{tr(data.user.gradeName)}</p>}
                  <span className="network-pill">
                    {data.mode === "demo" ? "DEMO ACCOUNT" : "VERIFIED ACCOUNT"}
                  </span>
                </section>
                <SiteControls />
                <ReferralCard code={data.referralCode} onNotice={setToast} />
                <SecuritySettings demo={data.mode === "demo"} />
                <div className="settings-list">
                  <div>
                    <Globe size={19} />
                    <span>{tr("네트워크")}</span>
                    <b>
                      {data.mode === "demo"
                        ? tr("데모")
                        : data.network === "nile"
                          ? "TRON · Nile"
                          : tr("TRON 메인넷")}
                    </b>
                  </div>
                  <div>
                    <WalletIcon size={19} />
                    <span>{tr("지원 자산")}</span>
                    <b>USDT · TRC20</b>
                  </div>
                  <button
                    onClick={async () => {
                      if (install) {
                        await install.prompt();
                        setInstall(null);
                      } else
                        setToast(
                          "Safari: 공유 → 홈 화면에 추가 / Chrome: 메뉴 → 앱 설치",
                        );
                    }}
                  >
                    <Download size={19} />
                    <span>{tr("홈 화면에 설치")}</span>
                    <ChevronRight size={16} />
                  </button>
                  {data.mode === "demo" ? (
                    <button
                      onClick={() => {
                        resetDemo();
                        setToast("데모 지갑을 초기화했습니다.");
                      }}
                    >
                      <History size={19} />
                      <span>{tr("데모 데이터 초기화")}</span>
                      <ChevronRight size={16} />
                    </button>
                  ) : null}
                  <button onClick={() => void logout()}>
                    <LogOut size={19} />
                    <span>{tr("로그아웃")}</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
                <p className="version">WU / VERSION 0.1.0</p>
              </>
            ) : null}
          </>
        ) : null}
        <BottomNav active={view === "home" ? "wallet" : view === "activity" || view === "settings" ? view : undefined} onWalletView={setView} />
      </main>
      <aside className="wallet-aside">
        <div className="red-promo">
          <span className="promo-number">01 / EVERYDAY FINANCE</span>
          <div className="promo-art">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="promo-token">
              <Token />
            </div>
            <span className="spark one">✦</span>
            <span className="spark two">+</span>
          </div>
          <h2>
            Less friction.
            <br />
            More freedom.
          </h2>
          <p>{tr("복잡함은 줄이고,")}<br />{tr("당신의 자산에 집중하세요.")}</p>
          <button onClick={() => setView("deposit")}>{tr("내 지갑에 입금하기 ")}<ArrowUpRight size={21} />
          </button>
        </div>
        <div className="aside-security">
          <ShieldCheck size={25} />
          <h3>Built around trust.</h3>
          <p>{tr("거래 내역을 한눈에 확인하고")}<br />{tr("자산의 흐름을 관리하세요.")}</p>
          <span>
            USDT ONLY <i /> TRC20 NETWORK
          </span>
        </div>
      </aside>
      {toast ? (
        <div className="toast" role="status">
          <Check size={17} />
          {tr(toast)}
        </div>
      ) : null}
      {selected ? (
        <TransactionModal
          transaction={selected}
          onClose={() => setSelected(null)}
          network={data?.network || "nile"}
        />
      ) : null}
    </div>
  );
}
function ReferralCard({code,onNotice}: {code?: string;onNotice:(text:string)=>void}) {
  const { tr } = useI18n();
  const [origin,setOrigin]=useState("");
  useEffect(()=>{setOrigin(location.origin);},[]);
  const link=code && origin ? `${origin}/login?ref=${encodeURIComponent(code)}` : "";
  async function copy(value:string,label:string) {
    try {await navigator.clipboard.writeText(value);onNotice(`${label}를 복사했습니다.`);}
    catch {onNotice("복사하지 못했습니다. 입력란의 내용을 직접 복사해 주세요.");}
  }
  if (!code) return null;
  return <section className="referral-card" aria-label={tr("추천 가입 링크")}>
    <label htmlFor="referral-link">{tr("추천 가입 링크")}</label>
    <div className="referral-link-row">
      <input id="referral-link" value={link} readOnly onFocus={e => e.currentTarget.select()} />
      <button type="button" className="referral-copy" aria-label={tr("추천링크 복사")} disabled={!link} onClick={() => void copy(link, "추천링크")}><Copy size={18} /></button>
    </div>
  </section>;
}
function Deposit({
  data,
  onUpdate,
  notify,
}: {
  data: WalletData;
  onUpdate: () => Promise<void>;
  notify: (value: string) => void;
}) {
  const { tr } = useI18n();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function create() {
    if (data.mode === "demo") {
      notify("실제 계정을 연결하면 전용 입금 주소가 생성됩니다.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/wallet/address", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await onUpdate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="deposit-view">
      <section className="deposit-card">
        <div className="deposit-heading">
          <Token small />
          <span>TRON · TRC20</span>
          <ArrowDownLeft size={23} />
        </div>
        <h1>{tr("내 지갑에")}<br />{tr("USDT 입금하기.")}</h1>
        <div className="qr-wrap">
          <QRCodeSVG
            value={data.address || "WU-DEMO-NOT-A-DEPOSIT-ADDRESS"}
            size={190}
            fgColor="#101010"
            bgColor="#17695a"
            level="H"
            marginSize={1}
          />
          <span className="qr-token">
            <Token small />
          </span>
          {!data.address ? (
            <span className="qr-demo">
              {data.mode === "demo" ? tr("DEMO · 입금 불가") : tr("주소 생성 대기")}
            </span>
          ) : null}
        </div>
        <div className="deposit-address">
          {data.address || tr("계정 연결 후 주소가 표시됩니다.")}
        </div>
      </section>
      <section className="deposit-info">
        <p className="network-warning">
          <ShieldCheck size={17} />
          <span>
            <b>{data.network === "nile" ? "TRON · Nile" : "TRON(TRC20)"}</b>{tr("의 USDT만 입금해 주세요.")}<br />{tr("다른 네트워크나 자산을 보내면 복구가 어려울 수 있습니다.")}</span>
        </p>
        <dl className="details">
          <div>
            <dt>{tr("입금 자산")}</dt>
            <dd>USDT</dd>
          </div>
          <div>
            <dt>{tr("네트워크")}</dt>
            <dd>
              {data.mode === "demo"
                ? tr("TRON · 데모")
                : data.network === "nile"
                  ? "TRON · Nile"
                  : "TRON (TRC20)"}
            </dd>
          </div>
          <div>
            <dt>{tr("잔액 반영")}</dt>
            <dd>{tr("블록체인 확정 후 자동 반영")}</dd>
          </div>
        </dl>
        {error ? (
          <p className="form-error" role="alert">
            {tr(error)}
          </p>
        ) : null}
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            if (data.address) {
              try {
                await navigator.clipboard.writeText(data.address);
                notify("입금 주소를 복사했습니다.");
              } catch {
                setError("주소를 직접 선택해 복사해 주세요.");
              }
            } else await create();
          }}
        >
          {data.address ? <Copy size={18} /> : <Plus size={18} />}{" "}
          {busy
            ? tr("주소 생성 중…")
            : data.address
              ? tr("입금 주소 복사")
              : tr("전용 입금 주소 생성")}
        </button>
      </section>
    </div>
  );
}
function Send({
  initialKind,
  data,
  onBack,
  onUpdate,
}: {
  initialKind: "internal" | "external";
  data: WalletData;
  onBack: () => void;
  onUpdate: () => Promise<void>;
}) {
  const { tr } = useI18n();
  const [kind, setKind] = useState<"internal" | "external">(initialKind),
    [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState(""),
    [stage, setStage] = useState<"form" | "review" | "done">("form"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const requestKey = useRef("");
  let units = 0n;
  try {
    units = parseUsdt(amount);
  } catch {}
  const fee = kind === "external" ? BigInt(data.fee) : 0n;
  function review() {
    setError("");
    try {
      const value = parseUsdt(amount);
      if (!recipient.trim()) throw new Error("받는 곳을 입력해 주세요.");
      if (
        kind === "internal" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())
      )
        throw new Error("회원 이메일을 입력해 주세요.");
      if (
        kind === "external" &&
        !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(recipient.trim())
      )
        throw new Error("TRON 주소를 확인해 주세요.");
      if (kind === "external" && value < BigInt(data.minimum))
        throw new Error(
          `최소 출금 금액은 ${formatUsdt(data.minimum)} USDT입니다.`,
        );
      if (value + fee > BigInt(data.available))
        throw new Error("사용 가능한 잔액이 부족합니다.");
      requestKey.current = crypto.randomUUID();
      setStage("review");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (data.mode === "demo")
        demoSend(kind, recipient.trim(), amount, requestKey.current);
      else {
        const response = await fetch("/api/wallet/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            recipient: recipient.trim(),
            amount,
            key: requestKey.current,
          }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
      }
      clearPreloadedData();
      await onUpdate();
      setStage("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (stage === "done")
    return (
      <div className="success-view">
        <span className="success-symbol">
          <Check size={42} />
        </span>
        <p className="eyebrow">
          {data.mode === "demo" ? "DEMO TRANSACTION" : "REQUEST RECEIVED"}
        </p>
        <h1>{kind === "internal" ? tr("송금 완료.") : tr("출금 요청 완료.")}</h1>
        <p>
          {kind === "internal"
            ? tr("회원 지갑으로 USDT를 보냈습니다.")
            : tr("관리자 승인 후 외부 지갑으로 전송됩니다.")}
        </p>
        <div className="success-amount">
          {formatUsdt(units)} <small>USDT</small>
        </div>
        <button className="primary" onClick={onBack}>{tr("내 지갑으로 돌아가기 ")}<ArrowRight size={18} />
        </button>
      </div>
    );
  return (
    <section className="send-view">
      <h1>{stage === "review" ? tr("송금 정보 확인") : tr("이체")}</h1>
      {stage === "form" ? (
        <>
          <div className="segmented">
            <button
              className={kind === "internal" ? "active" : ""}
              onClick={() => {
                setKind("internal");
                setError("");
              }}
            >{tr("회원에게 송금")}</button>
            <button
              className={kind === "external" ? "active" : ""}
              onClick={() => {
                setKind("external");
                setError("");
              }}
            >{tr("외부 지갑 출금")}</button>
          </div>
          <label className="field">
            <span>
              {kind === "internal" ? tr("받는 회원 이메일") : tr("받는 TRON 주소")}
            </span>
            <input
              type={kind === "internal" ? "email" : "text"}
              autoComplete="off"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={
                kind === "internal"
                  ? "name@example.com"
                  : tr("T로 시작하는 TRC20 주소")
              }
            />
          </label>
          {data.mode === "demo" && kind === "internal" ? (
            <p className="field-hint">{tr("데모 회원: min@example.com")}</p>
          ) : null}
          <label className="amount-field">
            <span>{tr("보낼 금액")}</span>
            <div>
              <input
                inputMode="decimal"
                aria-label={tr("송금 금액")}
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  if (/^\d*(\.\d{0,6})?$/.test(e.target.value))
                    setAmount(e.target.value);
                }}
              />
              <Token small />
            </div>
            <small>USDT</small>
          </label>
          <div className="amount-presets">
            {["20", "50", "100"].map((v) => (
              <button key={v} onClick={() => setAmount(v)}>
                {v} USDT
              </button>
            ))}
            <button
              onClick={() => {
                const maximum = BigInt(data.available) - fee;
                setAmount(maximum > 0n ? decimalUsdt(maximum) : "0");
              }}
            >{tr("최대")}</button>
          </div>

        </>
      ) : (
        <div className="review-card">
          <Token />
          <h2>
            {formatUsdt(units, 6)} <small>USDT</small>
          </h2>
          <p>{recipient}</p>
          <span className="network-pill">
            {kind === "internal"
              ? "INTERNAL TRANSFER"
              : `TRON · ${data.network === "nile" ? "NILE" : "TRC20"}`}
          </span>
        </div>
      )}
      <dl className="details">
        <div>
          <dt>{tr("사용 가능")}</dt>
          <dd>{formatUsdt(data.available)} USDT</dd>
        </div>
        <div>
          <dt>{tr("수수료")}</dt>
          <dd>{formatUsdt(fee)} USDT</dd>
        </div>
        <div>
          <dt>{tr("총 차감 금액")}</dt>
          <dd>{formatUsdt(units + fee, 6)} USDT</dd>
        </div>
      </dl>
      {kind === "external" ? (
        <p className="field-hint">{tr("최소 ")}{formatUsdt(data.minimum)} USDT</p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {tr(error)}
        </p>
      ) : null}
      <div className="send-actions">
      <button
        className="primary"
        disabled={busy}
        onClick={stage === "form" ? review : () => void submit()}
      >
        {busy
          ? tr("처리 중…")
          : stage === "form"
            ? tr("송금 정보 확인")
            : kind === "internal"
              ? tr("송금하기")
              : tr("출금 요청하기")}
        <ArrowUpRight size={19} />
      </button>
      {stage === "review" ? (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setStage("form")}
        >{tr("정보 수정")}</button>
      ) : null}
      </div>
    </section>
  );
}
function Activity({
  data,
  onSelect,
}: {
  data: WalletData;
  onSelect: (t: Transaction) => void;
}) {
  const { tr } = useI18n();
  const { localeTag } = useI18n();
  const [filter, setFilter] = useState<"rewards" | "transactions" | "swaps" | "orders">("rewards");
  const [history, setHistory] = useState<{ rewards: { id: string; type: string; amount: string; status: string; due_date: string; paid_at: string | null }[]; pools: { kind: string; cutoff: string; amount: string }[]; swaps: { id: string; direction: string; amount: string; received_amount: string; created_at: string }[]; orders: { id: string; product_name: string; quantity: number; total: string; currency: string; status: string; created_at: string }[] } | null>(null);
  const [loadedParts, setLoadedParts] = useState({ rewards: false, swaps: false, orders: false });
  const [loadError, setLoadError] = useState(""),
    [historyRevision, setHistoryRevision] = useState(0);
  useEffect(() => {
    if (data.mode === "demo") { setHistory({ rewards: [], pools: [], swaps: [], orders: [] }); setLoadedParts({ rewards: true, swaps: true, orders: true }); return; }
    const controller = new AbortController();
    const loadPart = <T,>(name: "rewards" | "swaps" | "orders", endpoint: string, toPart: (value: T) => Partial<NonNullable<typeof history>>) => {
      let networkDone = false;
      const apply = (value: T) => { setHistory(previous => ({ rewards: [], pools: [], swaps: [], orders: [], ...previous, ...toPart(value) })); setLoadedParts(previous => ({ ...previous, [name]: true })); };
      if (historyRevision === 0) void readPreloadedData<T>(endpoint).then(cached => {
        if (!controller.signal.aborted && !networkDone && cached) apply(cached);
      });
      void fetch(endpoint, { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error("내역을 불러오지 못했습니다.");
        const value = await response.json() as T;
        networkDone = true;
        if (!controller.signal.aborted) apply(value);
      }).catch(e => { networkDone = true; if (e.name !== "AbortError") setLoadError(e.message); });
    };
    loadPart<{ rewards: NonNullable<typeof history>["rewards"]; pools: NonNullable<typeof history>["pools"] }>("rewards", "/api/rewards", value => ({ rewards: value.rewards, pools: value.pools }));
    loadPart<{ history: NonNullable<typeof history>["swaps"] }>("swaps", "/api/points", value => ({ swaps: value.history }));
    loadPart<{ orders: NonNullable<typeof history>["orders"] }>("orders", "/api/shop", value => ({ orders: value.orders }));
    return () => controller.abort();
  }, [data.mode, historyRevision]);
  const rewards = [
    ...(history?.rewards || []).map(r => ({ id: r.id, date: r.paid_at || `${r.due_date}T00:00:00+09:00`, label: ({ referral: "추천리워드", sponsor: "후원리워드", mom: "맘리워드", daily: "데일리수당" } as Record<string, string>)[r.type] || r.type, amount: r.amount, status: ({ scheduled: "지급 예정", paid: "지급 완료", skipped: "미지급", reversed: "회수 완료", void: "권리 취소" } as Record<string, string>)[r.status] || r.status })),
    ...(history?.pools || []).map(p => ({ id: p.kind + p.cutoff, date: p.cutoff, label: p.kind === "lucky" ? "복주머니P" : "보물상자P", amount: p.amount, status: "지급 완료" })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const transactions = data.transactions.filter(t => ["deposit", "transfer_in", "transfer_out", "withdrawal"].includes(t.kind));
  const date = (value: string) => new Date(value).toLocaleDateString(localeTag, { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
  return <>
    <div className="filter-tabs history-tabs">
      {([ ["rewards", "수당내역"], ["transactions", "입출금·이체"], ["swaps", "전환내역"], ["orders", "구매내역"] ] as const).map(([key, label]) => <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{tr(label)}</button>)}
    </div>
    {loadError && filter !== "transactions" && <p role="alert">{tr(loadError)}</p>}
    {filter === "transactions" && <ActivityList transactions={transactions} onSelect={onSelect} />}
    {filter === "rewards" && loadedParts.rewards && history && (rewards.length ? rewards.map(r => <div className="history-entry" key={r.id}><div><strong>{tr(r.label)}</strong><small>{date(r.date)} · {tr(r.status)}</small></div><strong>{formatUsdt(r.amount, 0)} P</strong></div>) : <p className="history-empty">{tr("수당 내역이 없습니다.")}</p>)}
    {filter === "orders" && loadedParts.orders && history && (history.orders.length ? history.orders.map(order => <div className="history-entry" key={order.id}><div><strong>{tr(order.product_name)} × {order.quantity}</strong><small>{date(order.created_at)} · {tr(order.status === "cancelled" ? "취소·환불 완료" : order.status === "cancellation_requested" ? "취소 승인 대기" : "결제 완료")}</small>{order.status === "paid" && <CancelOrder orderId={order.id} onDone={async () => { clearPreloadedData(); setHistoryRevision(n => n + 1); }} />}</div><strong>{formatUsdt(order.total, order.currency === "POINT" ? 0 : 6)} {order.currency === "POINT" ? "P" : "USDT"}</strong></div>) : <p className="history-empty">{tr("아직 구매 내역이 없습니다.")}</p>)}
    {filter === "swaps" && loadedParts.swaps && history && (history.swaps.length ? history.swaps.map(swap => <div className="history-entry" key={swap.id}><div><strong>{swap.direction === "usdt_to_points" ? "USDT → P" : "P → USDT"}</strong><small>{date(swap.created_at)}</small></div><strong>{formatUsdt(swap.received_amount, swap.direction === "usdt_to_points" ? 0 : 6)} {swap.direction === "usdt_to_points" ? "P" : "USDT"}</strong></div>) : <p className="history-empty">{tr("전환 내역이 없습니다.")}</p>)}
  </>;
}
