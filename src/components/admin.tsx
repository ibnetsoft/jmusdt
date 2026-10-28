"use client";
import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  ArrowUpRight,
  ArrowDownLeft,
  Wallet,
  ShieldCheck,
  Search,
  ArrowRight,
  RefreshCw,
  Download,
  Check,
  X,
  ChevronRight,
  Activity,
  LogOut,
} from "lucide-react";
import type { AdminData, Transaction } from "@/lib/types";
import { formatUsdt } from "@/lib/money";
import { readDemo, demoAdminAction } from "@/lib/demo-store";
import {
  Brand,
  Status,
  Spinner,
  txDate,
  kindLabels,
  TransactionModal,
} from "./shared";
import { SecuritySettings } from "./security";
import { useDialogFocus } from "./dialog-focus";
type Tab =
  | "overview"
  | "withdrawals"
  | "transactions"
  | "users"
  | "operations"
  | "audit";
export function AdminApp() {
  const [data, setData] = useState<AdminData | null>(null),
    [tab, setTab] = useState<Tab>("overview"),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [decision, setDecision] = useState<{
      action: string;
      id: string;
      label: string;
    } | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Transaction | null>(null);
  const [reconciliation, setReconciliation] = useState<{
      onchain: string;
      liability: string;
      fees: string;
      difference: string;
      addresses: number;
      trx: string;
      energy: number;
      bandwidth: number;
      checkedAt: string;
    } | null>(null),
    [reconBusy, setReconBusy] = useState(false);
  useDialogFocus(Boolean(decision));
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body.mode === "demo" ? readDemo() : body);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const update = () => void refresh();
    const timer = setInterval(update, 30000);
    window.addEventListener("jmusdt-demo", update);
    window.addEventListener("storage", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("jmusdt-demo", update);
      window.removeEventListener("storage", update);
    };
  }, [refresh]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setDecision(null);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [busy]);
  async function act() {
    if (!decision) return;
    setBusy(true);
    setError("");
    try {
      if (data?.mode === "demo")
        demoAdminAction(decision.action, decision.id, reason);
      else {
        const response = await fetch("/api/admin/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...decision, reason }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
      }
      setMessage(`${decision.label} 처리했습니다.`);
      setDecision(null);
      setReason("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reconcile() {
    if (data?.mode === "demo") {
      setMessage("실제 지갑·DB 연결 후 온체인 자산 대사를 조회할 수 있습니다.");
      return;
    }
    setReconBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/reconciliation", {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setReconciliation(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReconBusy(false);
    }
  }
  const nav: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: "overview", label: "대시보드", icon: LayoutDashboard },
    { key: "withdrawals", label: "출금 관리", icon: ArrowUpRight },
    { key: "transactions", label: "거래 원장", icon: Activity },
    { key: "users", label: "회원 관리", icon: Users },
    { key: "operations", label: "지갑 운영", icon: Wallet },
    { key: "audit", label: "감사 로그", icon: ShieldCheck },
  ];
  const pending = data?.withdrawals.filter((t) => t.status === "pending") || [];
  const matches = (value: string) =>
    value.toLowerCase().includes(search.toLowerCase());
  const allAvailable =
    data?.users.reduce((sum, u) => sum + BigInt(u.available), 0n) || 0n;
  const allReserved =
    data?.users.reduce((sum, u) => sum + BigInt(u.reserved), 0n) || 0n;
  function open(action: string, id: string, label: string) {
    setDecision({ action, id, label });
    setReason("");
    setError("");
  }
  function csv() {
    if (!data) return;
    const rows = [
      [
        "id",
        "email",
        "kind",
        "amount_units",
        "fee_units",
        "status",
        "created_at",
        "txid",
      ],
      ...data.transactions.map((t) => [
        t.id,
        t.email,
        t.kind,
        t.amount,
        t.fee,
        t.status,
        t.created_at,
        t.txid || "",
      ]),
    ];
    const content =
      "\ufeff" +
      rows
        .map((row) =>
          row
            .map(
              (cell) =>
                '"' +
                String(cell)
                  .replace(/^[=+\-@]/, "'$&")
                  .replaceAll('"', '""') +
                '"',
            )
            .join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "jmusdt-transactions.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  function withdrawalTable(entries: AdminData["withdrawals"]) {
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>회원 / 요청 시각</th>
              <th>출금 금액</th>
              <th>받는 주소</th>
              <th>상태</th>
              <th>처리</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.email}</strong>
                  <small>{txDate(t.created_at)}</small>
                </td>
                <td>
                  <strong>
                    {formatUsdt(t.amount)} <em>USDT</em>
                  </strong>
                  <small>수수료 {formatUsdt(t.fee)}</small>
                </td>
                <td className="address-cell">
                  <button className="table-link" onClick={() => setSelected(t)}>
                    {t.destination}
                    <ArrowUpRight size={13} />
                  </button>
                </td>
                <td>
                  <Status value={t.status} />
                </td>
                <td>
                  {t.status === "pending" ? (
                    <div className="table-actions">
                      <button
                        onClick={() => open("approve", t.id, "출금 승인")}
                      >
                        <Check size={14} />
                        승인
                      </button>
                      <button
                        className="reject"
                        onClick={() => open("reject", t.id, "출금 반려")}
                      >
                        <X size={14} />
                        반려
                      </button>
                    </div>
                  ) : (
                    <button
                      className="table-link"
                      onClick={() => setSelected(t)}
                    >
                      상세 <ChevronRight size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length ? (
          <div className="admin-empty">해당 출금 요청이 없습니다.</div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <Brand admin />
        <div className="console-label">WORKSPACE / JMUSDT</div>
        <nav aria-label="관리자 메뉴">
          <button
            onClick={() => {
              location.href = "/admin/shop";
            }}
          >
            상품 관리
          </button>
          {nav.map((n) => (
            <button
              key={n.key}
              onClick={() => {
                setTab(n.key);
                setSearch("");
              }}
              className={tab === n.key ? "active" : ""}
            >
              <n.icon size={18} />
              {n.label}
              {n.key === "withdrawals" && pending.length ? (
                <b>{pending.length}</b>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <div>
            <ShieldCheck size={17} />
            <span>
              관리자 콘솔
              <small>
                {data?.mode === "demo" ? "DEMO WORKSPACE" : "LIVE WORKSPACE"}
              </small>
            </span>
          </div>
          <a href="/">
            사용자 지갑 열기 <ArrowUpRight size={15} />
          </a>
        </div>
      </aside>
      <div className="admin-content">
        <header className="admin-topbar">
          <span>
            Workspace <ChevronRight size={14} />{" "}
            <b>{nav.find((n) => n.key === tab)?.label}</b>
          </span>
          <div>
            <span className="admin-network">
              <i />
              TRON {data?.operations.network === "mainnet" ? "MAINNET" : "NILE"}
            </span>
            <span className="admin-avatar">JM</span>
          </div>
        </header>
        <main className="admin-main">
          <div className="admin-heading">
            <div>
              <p className="eyebrow">
                {tab === "overview"
                  ? "WALLET AT A GLANCE"
                  : "WALLET MANAGEMENT"}
              </p>
              <h1>{nav.find((n) => n.key === tab)?.label}</h1>
              <p>
                {tab === "overview"
                  ? "자산 흐름과 운영 상태를 한눈에 확인하세요."
                  : tab === "withdrawals"
                    ? "출금 정보를 확인하고 승인 또는 반려하세요."
                    : tab === "users"
                      ? "회원의 잔액과 계정 상태를 관리하세요."
                      : tab === "operations"
                        ? "체인 동기화와 자금 회수 상태를 확인하세요."
                        : tab === "audit"
                          ? "관리자의 처리 기록을 확인하세요."
                          : "모든 입출금과 회원 송금 기록을 확인하세요."}
              </p>
            </div>
            <div className="heading-actions">
              <button onClick={() => void refresh()}>
                <RefreshCw size={16} />
                새로고침
              </button>
              <button className="dark-button" onClick={csv}>
                <Download size={16} />
                거래 CSV
              </button>
            </div>
          </div>
          {data?.mode === "demo" ? (
            <div className="admin-demo">
              <span>
                <i />
                DEMO WORKSPACE
              </span>
              예시 데이터입니다. 승인해도 실제 전송되지 않습니다.
            </div>
          ) : null}
          {error ? (
            <div className="admin-error" role="alert">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="admin-message" role="status">
              {message}
              <button aria-label="알림 닫기" onClick={() => setMessage("")}>
                <X size={16} />
              </button>
            </div>
          ) : null}
          {!data && !error ? <Spinner /> : null}
          {data ? (
            <>
              {tab === "overview" ? (
                <>
                  <div className="metric-grid">
                    <Metric
                      label="회원 보유 자산"
                      value={formatUsdt(allAvailable + allReserved)}
                      unit="USDT"
                      note="표시 중인 회원의 가용 + 예약 잔액"
                      icon={Wallet}
                    />
                    <Metric
                      label="출금 예약 잔액"
                      value={formatUsdt(allReserved)}
                      unit="USDT"
                      note="승인·전송 대기 중인 자산"
                      icon={ArrowUpRight}
                    />
                    <Metric
                      label="승인 대기"
                      value={String(pending.length).padStart(2, "0")}
                      unit="건"
                      note="관리자 확인이 필요합니다"
                      icon={Activity}
                      accent
                    />
                    <Metric
                      label="회원 수"
                      value={String(data.users.length).padStart(2, "0")}
                      unit="명"
                      note={`활성 ${data.users.filter((u) => u.status === "active").length}명 · 표시된 회원 기준`}
                      icon={Users}
                    />
                  </div>
                  <div className="overview-panels">
                    <section className="admin-panel flow-panel">
                      <div className="panel-heading">
                        <h2>자산 분포</h2>
                        <span>현재 원장 기준</span>
                      </div>
                      <div className="allocation">
                        <div
                          className="allocation-ring"
                          style={{
                            background: `conic-gradient(#e83434 0 ${allAvailable + allReserved === 0n ? 0 : Number((allAvailable * 100n) / (allAvailable + allReserved))}%,#e9e9ed 0 100%)`,
                          }}
                        >
                          <div>
                            <span>총 보유 자산</span>
                            <strong>
                              {formatUsdt(allAvailable + allReserved, 0)}
                            </strong>
                            <small>USDT</small>
                          </div>
                        </div>
                        <div className="allocation-legend">
                          <div>
                            <i />
                            <span>사용 가능</span>
                            <b>{formatUsdt(allAvailable)}</b>
                          </div>
                          <div>
                            <i />
                            <span>출금 예약</span>
                            <b>{formatUsdt(allReserved)}</b>
                          </div>
                        </div>
                      </div>
                    </section>
                    <section className="admin-panel operational-panel">
                      <div className="panel-heading">
                        <h2>운영 상태</h2>
                        <ShieldCheck size={19} />
                      </div>
                      <div className="operational-status">
                        <span className="operational-icon">
                          <Activity size={24} />
                        </span>
                        <div>
                          <h3>
                            {data.mode === "demo"
                              ? "데모 환경"
                              : data.operations.cursor
                                ? "입금 동기화 중"
                                : "워커 설정 대기"}
                          </h3>
                          <p>
                            {data.mode === "demo"
                              ? "실제 체인 연결 전 UI 검토 환경입니다."
                              : data.operations.updated_at
                                ? `최근 동기화 ${txDate(data.operations.updated_at)}`
                                : "워커를 실행하면 입금 감지가 시작됩니다."}
                          </p>
                        </div>
                      </div>
                      <dl>
                        <div>
                          <dt>네트워크</dt>
                          <dd>TRON {data.operations.network.toUpperCase()}</dd>
                        </div>
                        <div>
                          <dt>스캔 블록</dt>
                          <dd>{data.operations.cursor || "—"}</dd>
                        </div>
                        <div>
                          <dt>온체인 전송</dt>
                          <dd>
                            {data.operations.broadcast ? "활성" : "비활성"}
                          </dd>
                        </div>
                      </dl>
                      <button onClick={() => setTab("operations")}>
                        지갑 운영 열기 <ArrowRight size={15} />
                      </button>
                    </section>
                  </div>
                  <section className="admin-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>
                          출금 승인 대기 <b>{pending.length}</b>
                        </h2>
                        <p>받는 주소와 금액을 확인해 주세요.</p>
                      </div>
                      <button onClick={() => setTab("withdrawals")}>
                        전체 보기 <ArrowRight size={15} />
                      </button>
                    </div>
                    {withdrawalTable(pending)}
                  </section>
                </>
              ) : null}
              {tab === "withdrawals" ? (
                <section className="admin-panel">
                  <div className="panel-heading">
                    <h2>
                      출금 요청 <b>{data.withdrawals.length}</b>
                    </h2>
                    <SearchField value={search} onChange={setSearch} />
                  </div>
                  {withdrawalTable(
                    data.withdrawals.filter((t) =>
                      matches(`${t.email} ${t.destination} ${t.status}`),
                    ),
                  )}
                </section>
              ) : null}
              {tab === "transactions" ? (
                <section className="admin-panel">
                  <div className="panel-heading">
                    <h2>거래 내역</h2>
                    <SearchField value={search} onChange={setSearch} />
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>거래 / 시각</th>
                          <th>회원</th>
                          <th>금액</th>
                          <th>상태</th>
                          <th>상세</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.transactions
                          .filter((t) =>
                            matches(`${t.email} ${t.id} ${kindLabels[t.kind]}`),
                          )
                          .map((t) => (
                            <tr key={t.id}>
                              <td>
                                <strong>{kindLabels[t.kind]}</strong>
                                <small>{txDate(t.created_at)}</small>
                              </td>
                              <td>{t.email}</td>
                              <td>
                                <strong>
                                  {formatUsdt(t.amount)} <em>USDT</em>
                                </strong>
                              </td>
                              <td>
                                <Status value={t.status} />
                              </td>
                              <td>
                                <button
                                  className="table-link"
                                  onClick={() => setSelected(t)}
                                >
                                  상세 <ArrowUpRight size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="table-footnote">
                    최근 200건 · CSV 금액은 USDT 최소 단위(1 USDT =
                    1,000,000)입니다.
                  </p>
                </section>
              ) : null}
              {tab === "users" ? (
                <section className="admin-panel">
                  <div className="panel-heading">
                    <h2>회원 목록</h2>
                    <SearchField value={search} onChange={setSearch} />
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>회원</th>
                          <th>사용 가능</th>
                          <th>출금 예약</th>
                          <th>상태</th>
                          <th>관리</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.users
                          .filter((u) => matches(`${u.name} ${u.email}`))
                          .map((u) => (
                            <tr key={u.id}>
                              <td>
                                <strong>{u.name}</strong>
                                <small>{u.email}</small>
                              </td>
                              <td>{formatUsdt(u.available)} USDT</td>
                              <td>{formatUsdt(u.reserved)} USDT</td>
                              <td>
                                <span className={`member-status ${u.status}`}>
                                  {u.status === "active" ? "활성" : "차단"}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="table-link"
                                  onClick={() =>
                                    open(
                                      u.status === "active"
                                        ? "block"
                                        : "unblock",
                                      u.id,
                                      u.status === "active"
                                        ? "회원 차단"
                                        : "차단 해제",
                                    )
                                  }
                                >
                                  {u.status === "active" ? "차단" : "차단 해제"}
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="table-footnote">
                    최근 가입 500명 · 잔액 수정은 허용하지 않습니다.
                  </p>
                </section>
              ) : null}
              {tab === "operations" ? (
                <>
                  <div className="metric-grid">
                    <Metric
                      label="연결 네트워크"
                      value={data.operations.network.toUpperCase()}
                      note="TRON USDT 전용"
                      icon={Wallet}
                    />
                    <Metric
                      label="마지막 스캔 블록"
                      value={data.operations.cursor || "—"}
                      note={
                        data.operations.updated_at
                          ? txDate(data.operations.updated_at)
                          : "워커 실행 대기"
                      }
                      icon={Activity}
                    />
                    <Metric
                      label="전송 상태"
                      value={data.operations.broadcast ? "활성" : "비활성"}
                      note="환경 설정으로 제어"
                      icon={ShieldCheck}
                    />
                  </div>
                  <section className="admin-panel custody-panel">
                    <h2>핫월렛</h2>
                    <code>
                      {data.operations.hotAddress ||
                        "핫월렛 주소가 설정되지 않았습니다."}
                    </code>
                    <p>
                      자금 회수 요청은 감사 로그에 기록되며, 별도의 수탁 운영
                      서비스에서 처리합니다. 입금 주소의 Energy·Bandwidth와 TRX
                      비용을 확인한 뒤 실행하세요.
                    </p>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>회원</th>
                            <th>자금 회수</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.users.map((u) => (
                            <tr key={u.id}>
                              <td>{u.email}</td>
                              <td>
                                <button
                                  className="table-link"
                                  onClick={() =>
                                    open("sweep", u.id, "자금 회수 요청")
                                  }
                                >
                                  회수 요청 <ArrowUpRight size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className="admin-panel custody-panel">
                    <div className="panel-heading">
                      <h2>자산 대사 · 핫월렛 자원</h2>
                      <button
                        disabled={reconBusy}
                        onClick={() => void reconcile()}
                      >
                        {reconBusy ? "조회 중…" : "대사 조회"}
                        <RefreshCw size={15} />
                      </button>
                    </div>
                    {reconciliation ? (
                      <>
                        <dl className="reconciliation-details">
                          <div>
                            <dt>확정 온체인 자산</dt>
                            <dd>
                              {formatUsdt(reconciliation.onchain, 6)} USDT
                            </dd>
                          </div>
                          <div>
                            <dt>회원 채무</dt>
                            <dd>
                              {formatUsdt(reconciliation.liability, 6)} USDT
                            </dd>
                          </div>
                          <div>
                            <dt>누적 수수료</dt>
                            <dd>{formatUsdt(reconciliation.fees, 6)} USDT</dd>
                          </div>
                          <div>
                            <dt>차이</dt>
                            <dd>
                              {formatUsdt(reconciliation.difference, 6)} USDT
                            </dd>
                          </div>
                          <div>
                            <dt>핫월렛 TRX</dt>
                            <dd>{formatUsdt(reconciliation.trx, 6)} TRX</dd>
                          </div>
                          <div>
                            <dt>Energy / Bandwidth</dt>
                            <dd>
                              {reconciliation.energy} /{" "}
                              {reconciliation.bandwidth}
                            </dd>
                          </div>
                        </dl>
                        <p>
                          {reconciliation.addresses}개 주소 ·{" "}
                          {txDate(reconciliation.checkedAt)} 조회. 새 입출금과
                          블록 확정의 시점 차이를 고려해 확인하세요.
                        </p>
                      </>
                    ) : (
                      <p>
                        연결된 체인의 관리 주소 잔액과 회원 채무를 비교합니다.
                        테스트 설정 후 조회할 수 있습니다.
                      </p>
                    )}
                  </section>
                  <SecuritySettings demo={data.mode === "demo"} />
                </>
              ) : null}
              {tab === "audit" ? (
                <section className="admin-panel">
                  <div className="panel-heading">
                    <h2>관리자 감사 로그</h2>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>시각</th>
                          <th>작업</th>
                          <th>처리자</th>
                          <th>상세</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.audit.map((a) => (
                          <tr key={a.id}>
                            <td>{txDate(a.created_at)}</td>
                            <td>{a.action}</td>
                            <td>{a.actor}</td>
                            <td>
                              <code className="audit-details">
                                {JSON.stringify(a.details)}
                              </code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.audit.length ? (
                      <div className="admin-empty">
                        아직 기록된 관리자 작업이 없습니다.
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
          <footer className="admin-footer">
            JMUSDT ADMIN <span>TRON / TRC20 · 한국 표준시(KST)</span>
          </footer>
        </main>
      </div>
      {decision ? (
        <div className="modal-backdrop">
          <section
            className="modal admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-title"
          >
            <button
              className="icon-button modal-close"
              disabled={busy}
              aria-label="닫기"
              onClick={() => setDecision(null)}
            >
              <X size={18} />
            </button>
            <p className="eyebrow">REVIEW & CONFIRM</p>
            <h2 id="decision-title">{decision.label}</h2>
            <p>처리 사유를 남겨 주세요. 이 작업은 감사 로그에 기록됩니다.</p>
            <label className="field">
              <span>처리 사유</span>
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="확인한 내용 또는 처리 사유"
              />
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="primary"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void act()}
            >
              {busy ? "처리 중…" : decision.label}
            </button>
          </section>
        </div>
      ) : null}
      {selected ? (
        <TransactionModal
          transaction={selected}
          network={data?.operations.network || "nile"}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
function Metric({
  label,
  value,
  unit,
  note,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
  icon: typeof Users;
  accent?: boolean;
}) {
  return (
    <section className={`metric ${accent ? "accent" : ""}`}>
      <div>
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      <p>{note}</p>
    </section>
  );
}
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="search-field">
      <Search size={16} />
      <input
        aria-label="목록 검색"
        placeholder="검색"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
