"use client";
import { useI18n } from "./i18n";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  House,
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
  Spinner,
  TransactionModal,
} from "./shared";
import { SecuritySettings } from "./security";
type View = "home" | "deposit" | "send" | "activity" | "settings";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export function WalletApp({initialView = "home"}: {initialView?: View}) {
  const { tr } = useI18n();
  const [data, setData] = useState<WalletData | null>(null),
    [view, setView] = useState<View>(initialView),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [hidden, setHidden] = useState(false),
    [selected, setSelected] = useState<Transaction | null>(null),
    [install, setInstall] = useState<InstallEvent | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/wallet", { cache: "no-store" });
      const body = await response.json();
      if (response.status === 401) {
        location.href = "/login";
        return;
      }
      if (!response.ok) throw new Error(body.error);
      setData(body.mode === "demo" ? demoSnapshot() : body);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "지갑을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const update = () => void refresh();
    window.addEventListener("jmusdt-demo", update);
    window.addEventListener("storage", update);
    const timer = setInterval(update, 30000);
    return () => {
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
    <div className="wallet-layout">
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
              location.href = "/rewards";
            }}
          >{tr("리워드 · 주머니")}</button>
          <button
            onClick={() => {
              location.href = "/organization";
            }}
          >{tr("추천 · 후원 조직도")}</button>
          <button
            onClick={() => {
              location.href = "/points";
            }}
          >{tr("포인트 · 1:1 전환")}</button>
          <button
            onClick={() => {
              location.href = "/shop";
            }}
          >{tr("쇼핑몰")}</button>
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
          <div className="profile">
            <span className="profile-avatar">
              {data?.user.name?.slice(0, 1) || "J"}
            </span>
            <span className="desktop-only">
              {data?.user.name || "My wallet"}
            </span>
            <button
              className="icon-button"
              aria-label={tr("마이페이지")}
              onClick={() => setView("settings")}
            >
              <Settings size={18} />
            </button>
          </div>
        </header>
        {data?.mode === "demo" ? (
          <div className="demo-strip">
            <span>
              <i />{tr("데모 지갑 · 실제 자산이 아닙니다")}</span>
            <a href="/login">{tr("계정 연결 ")}<ArrowUpRight size={12} />
            </a>
          </div>
        ) : data?.network === "nile" ? (
          <div className="demo-strip">
            <span>{tr("Nile 테스트넷 · 실제 USDT가 아닙니다")}</span>
          </div>
        ) : null}
        {error ? (
          <div className="error-banner" role="alert">
            {tr(error)}
            <button onClick={() => void refresh()}>{tr("다시 시도")}</button>
          </div>
        ) : null}
        {!data && !error ? <Spinner /> : null}
        {data ? (
          <>
            {view === "home" ? (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">A LITTLE MORE FREEDOM</p>
                    <h1>{tr("나의 일상,")}<br />{tr("하나의 지갑.")}</h1>
                  </div>
                  <span className="outline-token">
                    <Token />
                  </span>
                </div>
                <p>
                  <a href="/points">{tr("포인트")}{" "}
                    {hidden ? "••••••" : formatUsdt(data.points || "0", 6)}{tr(" P · USDT ↔ 포인트 전환")}</a>
                </p>
                <p>
                  <a href="/rewards">{tr("리워드 · 주머니 보기 →")}</a>
                </p>
                <section className="balance-card">
                  <div className="balance-title">
                    <span>{tr("사용 가능한 잔액")}</span>
                    <button
                      aria-label={hidden ? tr("잔액 표시") : tr("잔액 숨기기")}
                      onClick={() => setHidden(!hidden)}
                    >
                      {hidden ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                  <div className="balance-value">
                    {hidden ? "••••••" : formatUsdt(data.available)}
                    <span>USDT</span>
                  </div>
                  <div className="balance-bottom">
                    <span>
                      <i />
                      TRON · TRC20
                    </span>
                    <span>{tr("출금 예약")}{" "}
                      <b>{hidden ? "••••" : formatUsdt(data.reserved)}</b>
                    </span>
                  </div>
                </section>
                <div className="quick-actions">
                  <button onClick={() => setView("deposit")}>
                    <span>
                      <ArrowDownLeft size={24} />
                    </span>{tr("입금하기")}<ArrowRight size={19} />
                  </button>
                  <button onClick={() => setView("send")}>
                    <span>
                      <ArrowUpRight size={24} />
                    </span>{tr("송금하기")}<ArrowRight size={19} />
                  </button>
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
                <div className="secure-note">
                  <ShieldCheck size={16} />
                  <span>{tr("안전한 원장 관리 · USDT 전용 지갑")}</span>
                </div>
              </>
            ) : null}
            {view === "deposit" ? (
              <Deposit
                data={data}
                onBack={() => setView("home")}
                onUpdate={refresh}
                notify={setToast}
              />
            ) : null}
            {view === "send" ? (
              <Send
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
                <div className="page-heading compact">
                  <div>
                    <p className="eyebrow">MAKE IT YOURS</p>
                    <h1>{tr("마이페이지")}</h1>
                  </div>
                  <Settings className="muted" size={30} />
                </div>
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
                          ? tr("Nile 테스트넷")
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
                <p className="version">JMUSDT / VERSION 0.1.0</p>
              </>
            ) : null}
          </>
        ) : null}
        <nav className="bottom-nav" aria-label={tr("모바일 메뉴")}>
          <button
            onClick={() => {
              location.href = "/organization";
            }}
          >
            <House size={20} />
            <span>{tr("조직도")}</span>
          </button>
          <button
            onClick={() => {
              location.href = "/shop";
            }}
          >
            <Plus size={20} />
            <span>{tr("쇼핑몰")}</span>
          </button>
          {nav.map((n) => (
            <button
              className={view === n.view ? "active" : ""}
              key={n.view}
              onClick={() => setView(n.view)}
            >
              <n.icon size={20} />
              <span>{tr(n.label)}</span>
            </button>
          ))}
          <button
            className="send-nav"
            aria-label={tr("송금하기")}
            onClick={() => setView("send")}
          >
            <ArrowUpRight size={23} />
          </button>
        </nav>
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
  return <section className="referral-card" aria-labelledby="referral-title">
    <h2 id="referral-title">{tr("내 추천 정보")}</h2>
    {code ? <>
      <label className="field">{tr("자동 생성된 추천코드")}<input value={code} readOnly /></label>
      <button className="secondary-button" onClick={()=>void copy(code,"추천코드")}><Copy size={16}/>{tr(" 추천코드 복사")}</button>
      <label className="field">{tr("추천 가입 링크")}<input value={link} readOnly onFocus={e=>e.currentTarget.select()} /></label>
      <button className="secondary-button" disabled={!link} onClick={()=>void copy(link,"추천링크")}><Copy size={16}/>{tr(" 추천링크 복사")}</button>
    </> : <p className="muted">{tr("실제 회원 계정으로 로그인하면 자동 생성된 추천 정보를 확인할 수 있습니다.")}</p>}
  </section>;
}
function Back({ onBack }: { onBack: () => void }) {
  const { tr } = useI18n();
  return (
    <button className="back-button" onClick={onBack}>
      <ArrowLeft size={18} />{tr("내 지갑")}</button>
  );
}
function Deposit({
  data,
  onBack,
  onUpdate,
  notify,
}: {
  data: WalletData;
  onBack: () => void;
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
      <Back onBack={onBack} />
      <section className="deposit-card">
        <div className="deposit-heading">
          <Token small />
          <span>TRON · TRC20</span>
          <ArrowDownLeft size={23} />
        </div>
        <h1>{tr("내 지갑에")}<br />{tr("USDT 입금하기.")}</h1>
        <div className="qr-wrap">
          <QRCodeSVG
            value={data.address || "JMUSDT-DEMO-NOT-A-DEPOSIT-ADDRESS"}
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
        <p className="qr-caption">
          {data.address
            ? tr("아래 주소로 USDT를 보내 주세요.")
            : tr("전용 입금 주소로 간편하게")}
        </p>
        <div className="deposit-address">
          {data.address || tr("계정 연결 후 주소가 표시됩니다.")}
        </div>
      </section>
      <section className="deposit-info">
        <p className="network-warning">
          <ShieldCheck size={17} />
          <span>
            <b>{data.network === "nile" ? tr("Nile 테스트넷") : "TRON(TRC20)"}</b>{tr("의 USDT만 입금해 주세요.")}<br />{tr("다른 네트워크나 자산을 보내면 복구가 어려울 수 있습니다.")}</span>
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
                  ? tr("Nile 테스트넷")
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
  data,
  onBack,
  onUpdate,
}: {
  data: WalletData;
  onBack: () => void;
  onUpdate: () => Promise<void>;
}) {
  const { tr } = useI18n();
  const [kind, setKind] = useState<"internal" | "external">("internal"),
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
      <Back onBack={onBack} />
      <p className="eyebrow">MOVE MONEY, SIMPLY</p>
      <h1>
        {stage === "review"
          ? tr("송금 정보를\n확인하세요.")
          : tr("필요한 곳으로,\n간편하게 송금.")}
      </h1>
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
          <div className="keypad" aria-label={tr("금액 입력 키패드")}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map(
              (k) => (
                <button
                  key={k}
                  aria-label={k === "⌫" ? tr("한 자리 지우기") : k}
                  onClick={() => {
                    const next = k === "⌫" ? amount.slice(0, -1) : amount + k;
                    if (/^\d*(\.\d{0,6})?$/.test(next)) setAmount(next);
                  }}
                >
                  {k}
                </button>
              ),
            )}
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
        <p className="field-hint">{tr("최소 ")}{formatUsdt(data.minimum)}{tr(" USDT · 관리자 승인 후 전송됩니다.")}</p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {tr(error)}
        </p>
      ) : null}
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
  const [filter, setFilter] = useState("all");
  const filtered = data.transactions.filter(
    (t) =>
      filter === "all" ||
      (filter === "in"
        ? t.kind === "deposit" ||
          t.kind === "transfer_in" ||
          t.kind === "swap_in" ||
          t.kind === "refund" ||
          t.kind === "reward"
        : t.kind === "transfer_out" ||
          t.kind === "withdrawal" ||
          t.kind === "purchase" ||
          t.kind === "swap_out" ||
          t.kind === "reward_reversal" ||
          t.kind === "reward_recovery"),
  );
  return (
    <>
      <div className="page-heading compact">
        <div>
          <p className="eyebrow">EVERY MOVE, IN ONE PLACE</p>
          <h1>{tr("거래 내역")}</h1>
        </div>
        <History size={30} className="muted" />
      </div>
      <div className="filter-tabs">
        {[
          ["all", "전체"],
          ["in", "받은 내역"],
          ["out", "보낸 내역"],
        ].map(([key, label]) => (
          <button
            className={filter === key ? "active" : ""}
            onClick={() => setFilter(key)}
            key={key}
          >
            {tr(label)}
          </button>
        ))}
      </div>
      <ActivityList transactions={filtered} onSelect={onSelect} />
      <p className="field-hint">{tr("최근 100건 · 시각은 한국 표준시(KST)입니다.")}</p>
    </>
  );
}
