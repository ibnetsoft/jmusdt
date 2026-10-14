"use client";
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
export function WalletApp() {
  const [data, setData] = useState<WalletData | null>(null),
    [view, setView] = useState<View>("home"),
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
    { view: "settings" as View, label: "설정", icon: Settings },
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
        <nav aria-label="주 메뉴">
          {nav.map((n) => (
            <button
              key={n.view}
              className={view === n.view ? "active" : ""}
              onClick={() => setView(n.view)}
            >
              <n.icon size={20} />
              {n.label}
              {view === n.view ? <span className="nav-dot" /> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="network-pill">
            <i />
            TRON NETWORK
          </span>
          <p>
            심플하게 보내고,
            <br />
            안전하게 보관하세요.
          </p>
          <a href="/admin">
            관리자 콘솔 <ExternalLink size={14} />
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
              aria-label="설정"
              onClick={() => setView("settings")}
            >
              <Settings size={18} />
            </button>
          </div>
        </header>
        {data?.mode === "demo" ? (
          <div className="demo-strip">
            <span>
              <i />
              데모 지갑 · 실제 자산이 아닙니다
            </span>
            <a href="/login">
              계정 연결 <ArrowUpRight size={12} />
            </a>
          </div>
        ) : data?.network === "nile" ? (
          <div className="demo-strip">
            <span>Nile 테스트넷 · 실제 USDT가 아닙니다</span>
          </div>
        ) : null}
        {error ? (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => void refresh()}>다시 시도</button>
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
                    <h1>
                      나의 일상,
                      <br />
                      하나의 지갑.
                    </h1>
                  </div>
                  <span className="outline-token">
                    <Token />
                  </span>
                </div>
                <section className="balance-card">
                  <div className="balance-title">
                    <span>사용 가능한 잔액</span>
                    <button
                      aria-label={hidden ? "잔액 표시" : "잔액 숨기기"}
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
                    <span>
                      출금 예약{" "}
                      <b>{hidden ? "••••" : formatUsdt(data.reserved)}</b>
                    </span>
                  </div>
                </section>
                <div className="quick-actions">
                  <button onClick={() => setView("deposit")}>
                    <span>
                      <ArrowDownLeft size={24} />
                    </span>
                    입금하기
                    <ArrowRight size={19} />
                  </button>
                  <button onClick={() => setView("send")}>
                    <span>
                      <ArrowUpRight size={24} />
                    </span>
                    송금하기
                    <ArrowRight size={19} />
                  </button>
                </div>
                <div className="section-heading">
                  <h2>최근 거래</h2>
                  <button onClick={() => setView("activity")}>
                    전체 보기 <ChevronRight size={15} />
                  </button>
                </div>
                <ActivityList
                  transactions={data.transactions.slice(0, 4)}
                  onSelect={setSelected}
                />
                <div className="secure-note">
                  <ShieldCheck size={16} />
                  <span>안전한 원장 관리 · USDT 전용 지갑</span>
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
                    <h1>설정</h1>
                  </div>
                  <Settings className="muted" size={30} />
                </div>
                <section className="settings-profile">
                  <span className="profile-avatar large">
                    {data.user.name.slice(0, 1)}
                  </span>
                  <h2>{data.user.name}</h2>
                  <p>{data.user.email}</p>
                  <span className="network-pill">
                    {data.mode === "demo" ? "DEMO ACCOUNT" : "VERIFIED ACCOUNT"}
                  </span>
                </section>
                <SecuritySettings demo={data.mode === "demo"} />
                <div className="settings-list">
                  <div>
                    <Globe size={19} />
                    <span>네트워크</span>
                    <b>
                      {data.mode === "demo"
                        ? "데모"
                        : data.network === "nile"
                          ? "Nile 테스트넷"
                          : "TRON 메인넷"}
                    </b>
                  </div>
                  <div>
                    <WalletIcon size={19} />
                    <span>지원 자산</span>
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
                    <span>홈 화면에 설치</span>
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
                      <span>데모 데이터 초기화</span>
                      <ChevronRight size={16} />
                    </button>
                  ) : null}
                  <button onClick={() => void logout()}>
                    <LogOut size={19} />
                    <span>로그아웃</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
                <p className="version">JMUSDT / VERSION 0.1.0</p>
              </>
            ) : null}
          </>
        ) : null}
        <nav className="bottom-nav" aria-label="모바일 메뉴">
          {nav.map((n) => (
            <button
              className={view === n.view ? "active" : ""}
              key={n.view}
              onClick={() => setView(n.view)}
            >
              <n.icon size={20} />
              <span>{n.label}</span>
            </button>
          ))}
          <button
            className="send-nav"
            aria-label="송금하기"
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
          <p>
            복잡함은 줄이고,
            <br />
            당신의 자산에 집중하세요.
          </p>
          <button onClick={() => setView("deposit")}>
            내 지갑에 입금하기 <ArrowUpRight size={21} />
          </button>
        </div>
        <div className="aside-security">
          <ShieldCheck size={25} />
          <h3>Built around trust.</h3>
          <p>
            거래 내역을 한눈에 확인하고
            <br />
            자산의 흐름을 관리하세요.
          </p>
          <span>
            USDT ONLY <i /> TRC20 NETWORK
          </span>
        </div>
      </aside>
      {toast ? (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
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
function Back({ onBack }: { onBack: () => void }) {
  return (
    <button className="back-button" onClick={onBack}>
      <ArrowLeft size={18} />내 지갑
    </button>
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
        <h1>
          내 지갑에
          <br />
          USDT 입금하기.
        </h1>
        <div className="qr-wrap">
          <QRCodeSVG
            value={data.address || "JMUSDT-DEMO-NOT-A-DEPOSIT-ADDRESS"}
            size={190}
            fgColor="#101010"
            bgColor="#e83434"
            level="H"
            marginSize={1}
          />
          <span className="qr-token">
            <Token small />
          </span>
          {!data.address ? (
            <span className="qr-demo">
              {data.mode === "demo" ? "DEMO · 입금 불가" : "주소 생성 대기"}
            </span>
          ) : null}
        </div>
        <p className="qr-caption">
          {data.address
            ? "아래 주소로 USDT를 보내 주세요."
            : "전용 입금 주소로 간편하게"}
        </p>
        <div className="deposit-address">
          {data.address || "계정 연결 후 주소가 표시됩니다."}
        </div>
      </section>
      <section className="deposit-info">
        <p className="network-warning">
          <ShieldCheck size={17} />
          <span>
            <b>{data.network === "nile" ? "Nile 테스트넷" : "TRON(TRC20)"}</b>의
            USDT만 입금해 주세요.
            <br />
            다른 네트워크나 자산을 보내면 복구가 어려울 수 있습니다.
          </span>
        </p>
        <dl className="details">
          <div>
            <dt>입금 자산</dt>
            <dd>USDT</dd>
          </div>
          <div>
            <dt>네트워크</dt>
            <dd>
              {data.mode === "demo"
                ? "TRON · 데모"
                : data.network === "nile"
                  ? "Nile 테스트넷"
                  : "TRON (TRC20)"}
            </dd>
          </div>
          <div>
            <dt>잔액 반영</dt>
            <dd>블록체인 확정 후 자동 반영</dd>
          </div>
        </dl>
        {error ? (
          <p className="form-error" role="alert">
            {error}
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
            ? "주소 생성 중…"
            : data.address
              ? "입금 주소 복사"
              : "전용 입금 주소 생성"}
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
        <h1>{kind === "internal" ? "송금 완료." : "출금 요청 완료."}</h1>
        <p>
          {kind === "internal"
            ? "회원 지갑으로 USDT를 보냈습니다."
            : "관리자 승인 후 외부 지갑으로 전송됩니다."}
        </p>
        <div className="success-amount">
          {formatUsdt(units)} <small>USDT</small>
        </div>
        <button className="primary" onClick={onBack}>
          내 지갑으로 돌아가기 <ArrowRight size={18} />
        </button>
      </div>
    );
  return (
    <section className="send-view">
      <Back onBack={onBack} />
      <p className="eyebrow">MOVE MONEY, SIMPLY</p>
      <h1>
        {stage === "review"
          ? "송금 정보를\n확인하세요."
          : "필요한 곳으로,\n간편하게 송금."}
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
            >
              회원에게 송금
            </button>
            <button
              className={kind === "external" ? "active" : ""}
              onClick={() => {
                setKind("external");
                setError("");
              }}
            >
              외부 지갑 출금
            </button>
          </div>
          <label className="field">
            <span>
              {kind === "internal" ? "받는 회원 이메일" : "받는 TRON 주소"}
            </span>
            <input
              type={kind === "internal" ? "email" : "text"}
              autoComplete="off"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={
                kind === "internal"
                  ? "name@example.com"
                  : "T로 시작하는 TRC20 주소"
              }
            />
          </label>
          {data.mode === "demo" && kind === "internal" ? (
            <p className="field-hint">데모 회원: min@example.com</p>
          ) : null}
          <label className="amount-field">
            <span>보낼 금액</span>
            <div>
              <input
                inputMode="decimal"
                aria-label="송금 금액"
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
            >
              최대
            </button>
          </div>
          <div className="keypad" aria-label="금액 입력 키패드">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map(
              (k) => (
                <button
                  key={k}
                  aria-label={k === "⌫" ? "한 자리 지우기" : k}
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
          <dt>사용 가능</dt>
          <dd>{formatUsdt(data.available)} USDT</dd>
        </div>
        <div>
          <dt>수수료</dt>
          <dd>{formatUsdt(fee)} USDT</dd>
        </div>
        <div>
          <dt>총 차감 금액</dt>
          <dd>{formatUsdt(units + fee, 6)} USDT</dd>
        </div>
      </dl>
      {kind === "external" ? (
        <p className="field-hint">
          최소 {formatUsdt(data.minimum)} USDT · 관리자 승인 후 전송됩니다.
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="primary"
        disabled={busy}
        onClick={stage === "form" ? review : () => void submit()}
      >
        {busy
          ? "처리 중…"
          : stage === "form"
            ? "송금 정보 확인"
            : kind === "internal"
              ? "송금하기"
              : "출금 요청하기"}
        <ArrowUpRight size={19} />
      </button>
      {stage === "review" ? (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setStage("form")}
        >
          정보 수정
        </button>
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
  const [filter, setFilter] = useState("all");
  const filtered = data.transactions.filter(
    (t) =>
      filter === "all" ||
      (filter === "in"
        ? t.kind === "deposit" || t.kind === "transfer_in"
        : t.kind === "transfer_out" || t.kind === "withdrawal"),
  );
  return (
    <>
      <div className="page-heading compact">
        <div>
          <p className="eyebrow">EVERY MOVE, IN ONE PLACE</p>
          <h1>거래 내역</h1>
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
            {label}
          </button>
        ))}
      </div>
      <ActivityList transactions={filtered} onSelect={onSelect} />
      <p className="field-hint">최근 100건 · 시각은 한국 표준시(KST)입니다.</p>
    </>
  );
}
