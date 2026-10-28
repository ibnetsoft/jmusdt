"use client";
import { useEffect, useRef, useState } from "react";
import { formatUsdt } from "@/lib/money";
import "./shop.css";
import "./organization.css";
type Node = {
  left_occupied: boolean;
  right_occupied: boolean;
  id: string;
  name: string;
  code: string;
  created_at: string;
  position: "L" | "R" | null;
  status: string;
  has_children: boolean;
  sales: string;
  parent_id: string | null;
  depth: number;
};
type Data = {
  viewer: string;
  code: string;
  nodes: Node[];
  pending: { id: string; name: string; code: string }[];
  truncated: boolean;
  pendingTruncated: boolean;
};
type Placement = {
  memberId: string;
  sponsorId: string;
  position: "L" | "R";
  name: string;
};
export function Organization() {
  const [data, setData] = useState<Data | null>(null),
    [mode, setMode] = useState<"referral" | "sponsor">("sponsor"),
    [depth, setDepth] = useState(3),
    [path, setPath] = useState<{ id: string; name: string }[]>([]),
    [selected, setSelected] = useState(""),
    [placement, setPlacement] = useState<Placement | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [full, setFull] = useState(false),
    [origin, setOrigin] = useState("");
  const viewport = useRef<HTMLDivElement>(null),
    tree = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    pointers = useRef(new Map<number, { x: number; y: number }>()),
    lock = useRef(false);
  const root = path.at(-1)?.id;
  useEffect(() => {
    setOrigin(location.origin);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    fetch(
      "/api/organization?" +
        new URLSearchParams({
          mode,
          depth: String(depth),
          ...(root ? { root } : {}),
        }),
      { cache: "no-store", signal: abort.signal },
    )
      .then(async (r) => {
        if (r.status === 401) {
          location.href = "/login";
          return;
        }
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [mode, depth, root, revision]);
  function center() {
    const v = viewport.current?.getBoundingClientRect(),
      r = tree.current?.querySelector(".org-root")?.getBoundingClientRect();
    if (v && r)
      setPan((p) => ({
        x: p.x + v.left + v.width / 2 - r.left - r.width / 2,
        y: p.y + v.top + 30 - r.top,
      }));
  }
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    const id = requestAnimationFrame(center);
    return () => cancelAnimationFrame(id);
  }, [data, full, loading]);
  useEffect(() => {
    if (placement) dialog.current?.showModal();
    else dialog.current?.close();
  }, [placement]);
  const clamp = (n: number) => Math.min(2.5, Math.max(0.15, n));
  async function place() {
    if (!placement || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(placement),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSelected("");
      setNotice("좌·우 배치가 완료되었습니다. 추천 관계는 유지됩니다.");
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "배치 실패");
      setRevision((n) => n + 1);
    } finally {
      setPlacement(null);
      setSaving(false);
      lock.current = false;
    }
  }
  function enter(node: Node) {
    setPath((p) => [...p, { id: node.id, name: node.name }]);
    setSelected("");
  }
  const byParent = new Map<string, Node[]>();
  for (const n of data?.nodes || []) {
    if (n.parent_id)
      byParent.set(n.parent_id, [...(byParent.get(n.parent_id) || []), n]);
  }
  function vacant(node: Node, position: "L" | "R") {
    return (
      <button
        className="org-vacant"
        disabled={!selected || saving || loading || node.status !== "active"}
        onClick={() =>
          setPlacement({
            memberId: selected,
            sponsorId: node.id,
            position,
            name: node.name,
          })
        }
      >
        {position === "L" ? "좌측" : "우측"} 빈 자리
        {selected ? " · 배치하기" : ""}
      </button>
    );
  }
  function renderNode(node: Node, top = false): React.ReactNode {
    const children = byParent.get(node.id) || [];
    return (
      <div className="org-branch" key={node.id}>
        <button
          className={`org-card ${top ? "org-root" : ""}`}
          onClick={() => enter(node)}
          aria-label={`${node.name} 하위 조직 보기`}
        >
          <strong>{node.name}</strong>
          <span>ID {node.code}</span>
          <span>
            가입 {new Date(node.created_at).toLocaleDateString("ko-KR")}
          </span>
          <span>순구매 {formatUsdt(node.sales)} P 환산</span>
          {node.status !== "active" && <span>이용 제한</span>}
          {node.has_children && !children.length && (
            <span>하위 조직 보기 ↓</span>
          )}
        </button>
        {mode === "sponsor" && (depth === 0 || node.depth < depth) ? (
          <div className="org-children">
            {(["L", "R"] as const).map((position) => (
              <div className="org-slot" key={position}>
                <span>{position === "L" ? "좌측 · L" : "우측 · R"}</span>
                {children.find((c) => c.position === position) ? (
                  renderNode(children.find((c) => c.position === position)!)
                ) : (
                    position === "L" ? node.left_occupied : node.right_occupied
                  ) ? (
                  <button onClick={() => enter(node)}>하위 조직 열기</button>
                ) : (
                  vacant(node, position)
                )}
              </div>
            ))}
          </div>
        ) : children.length > 0 ? (
          <div className="org-children">
            {children.map((child) => renderNode(child))}
          </div>
        ) : null}
      </div>
    );
  }
  const invite = origin && data ? `${origin}/login?ref=${data.code}` : "";
  return (
    <main className="commerce">
      <header>
        <a href="/">← 내 지갑</a>
        <a href="/shop">쇼핑몰</a>
      </header>
      <p className="shop-kicker">JMUSDT / ORGANIZATION</p>
      <h1>함께 만드는 조직.</h1>
      <p className="shop-muted">
        추천 관계는 그대로, 후원 조직은 좌·우로 배치하세요.
      </p>
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
      {data && (
        <section className="shop-editor">
          <p>
            내 추천 코드 <strong>{data.code}</strong>
          </p>
          <label>
            추천 가입 링크
            <input readOnly value={invite} />
          </label>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(invite);
                setNotice("추천 링크를 복사했습니다.");
              } catch {
                setNotice("위 추천 링크를 직접 복사해 주세요.");
              }
            }}
          >
            추천 링크 복사
          </button>
        </section>
      )}
      <div className="org-controls">
        <button
          disabled={saving}
          aria-pressed={mode === "referral"}
          onClick={() => {
            setMode("referral");
            setPath([]);
            setSelected("");
          }}
        >
          추천 조직도
        </button>
        <button
          disabled={saving}
          aria-pressed={mode === "sponsor"}
          onClick={() => {
            setMode("sponsor");
            setPath([]);
            setSelected("");
          }}
        >
          후원 조직도
        </button>
        <label>
          표시 단계
          <select
            value={depth}
            disabled={saving}
            onChange={(e) => setDepth(Number(e.target.value))}
          >
            {[3, 5, 10, 15, 20, 0].map((n) => (
              <option value={n} key={n}>
                {n ? n + "단계" : "전체 (최대 500명)"}
              </option>
            ))}
          </select>
        </label>
        <button disabled={saving} onClick={() => setRevision((n) => n + 1)}>
          새로고침
        </button>
      </div>
      {mode === "sponsor" && (
        <section className="shop-editor">
          <h2>내가 추천한 미배치 회원 ({data?.pending.length || 0})</h2>
          {data?.pendingTruncated && (
            <p>
              미배치 회원 500명까지 표시됩니다. 배치 후 새로고침하면 다음
              회원을 확인할 수 있습니다.
            </p>
          )}
          <label>
            배치할 회원
            <select
              disabled={saving || loading}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">회원을 선택하고 빈 자리를 누르세요</option>
              {data?.pending.map((n) => (
                <option value={n.id} key={n.id}>
                  {n.name} · {n.code}
                </option>
              ))}
            </select>
          </label>
          <p className="shop-muted">
            이메일 인증 후 로그인한 정상 회원만 표시됩니다. 배치 후에는 위치를
            바꿀 수 없습니다.
          </p>
        </section>
      )}
      <nav className="org-breadcrumbs" aria-label="조직 경로">
        <button disabled={saving} onClick={() => setPath([])}>
          내 조직
        </button>
        {path.map((p, i) => (
          <button
            key={`${p.id}-${i}`}
            disabled={saving}
            onClick={() => setPath(path.slice(0, i + 1))}
          >
            › {p.name}
          </button>
        ))}
        {path.length > 0 && (
          <button onClick={() => setPath((p) => p.slice(0, -1))}>← 이전</button>
        )}
      </nav>
      <section className={`org-board ${full ? "org-fullscreen" : ""}`}>
        <div className="org-board-toolbar">
          <button onClick={() => setZoom((z) => clamp(z - 0.1))}>축소</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => clamp(z + 0.1))}>확대</button>
          <button
            onClick={() => {
              setZoom(1);
              requestAnimationFrame(center);
            }}
          >
            중앙 정렬
          </button>
          <button onClick={() => setFull(!full)}>
            {full ? "전체화면 닫기" : "전체화면"}
          </button>
        </div>
        <p className="shop-muted">
          드래그 이동 · 두 손가락 확대/축소 · 회원을 누르면 하위 조직으로 이동
        </p>
        {loading && <p role="status">조직도를 불러오는 중…</p>}
        {data?.truncated && (
          <p role="status">
            조회 한도 500명까지 표시했습니다. 회원을 눌러 하위 조직을
            확인하세요.
          </p>
        )}
        <div
          className="org-viewport"
          ref={viewport}
          tabIndex={0}
          aria-label="조직도 이동 영역"
          onKeyDown={(e) => {
            const delta: Record<string, [number, number]> = {
              ArrowLeft: [40, 0],
              ArrowRight: [-40, 0],
              ArrowUp: [0, 40],
              ArrowDown: [0, -40],
            };
            if (delta[e.key] && e.target === e.currentTarget) {
              e.preventDefault();
              const [x, y] = delta[e.key];
              setPan((p) => ({ x: p.x + x, y: p.y + y }));
            }
          }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          }}
          onPointerMove={(e) => {
            const old = pointers.current.get(e.pointerId);
            if (!old) return;
            const before = [...pointers.current.values()];
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const after = [...pointers.current.values()];
            if (after.length === 1)
              setPan((p) => ({
                x: p.x + e.clientX - old.x,
                y: p.y + e.clientY - old.y,
              }));
            else if (after.length === 2) {
              const dist = (
                a: { x: number; y: number },
                b: { x: number; y: number },
              ) => Math.hypot(a.x - b.x, a.y - b.y);
              const d = dist(before[0], before[1]);
              if (d > 0)
                setZoom((z) => clamp((z * dist(after[0], after[1])) / d));
            }
          }}
          onPointerUp={(e) => pointers.current.delete(e.pointerId)}
          onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
          onLostPointerCapture={(e) => pointers.current.delete(e.pointerId)}
        >
          <div
            ref={tree}
            className="org-tree"
            style={{
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
          >
            {!loading && data?.nodes[0] && renderNode(data.nodes[0], true)}
          </div>
        </div>
      </section>
      <dialog
        ref={dialog}
        onCancel={(e) => {
          if (saving) e.preventDefault();
          else setPlacement(null);
        }}
        aria-labelledby="placement-title"
      >
        <h2 id="placement-title">후원 자리 배치 확인</h2>
        <p>
          {data?.pending.find((n) => n.id === placement?.memberId)?.name} 회원을{" "}
          {placement?.name}님의 {placement?.position === "L" ? "좌측" : "우측"}
          에 배치합니다.
        </p>
        <p>추천 관계는 바뀌지 않으며 배치 후에는 이동할 수 없습니다.</p>
        <button className="shop-primary" disabled={saving} onClick={place}>
          {saving ? "배치 중…" : "배치 확정"}
        </button>
        <button disabled={saving} onClick={() => setPlacement(null)}>
          취소
        </button>
      </dialog>
    </main>
  );
}
