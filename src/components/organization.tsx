"use client";
import { useI18n } from "./i18n";
import { getVerifiedPageData, subscribeVerifiedPageData, preloadPages, fetchPageData } from "@/lib/preload-pages";
import { BottomNav } from "./bottom-nav";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatUsdt } from "@/lib/money";
import "./shop.css";
import "./organization.css";
type Node = {
  id: string;
  name: string;
  code: string;
  created_at: string;
  referral_ordinal: string | null;
  rollup_generation: number;
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
  eligible: boolean;
  pending: { id: string; name: string; code: string; placement_reason: string }[];
  truncated: boolean;
  pendingTruncated: boolean;
};
export function Organization() {
  const { tr, localeTag } = useI18n();
  const [data, setData] = useState<Data | null>(null),
    [mode, setMode] = useState<"referral" | "sponsor">("sponsor"),
    [depth, setDepth] = useState(3),
    [path, setPath] = useState<{ id: string; name: string }[]>([]),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [full, setFull] = useState(false);
  const viewport = useRef<HTMLDivElement>(null),
    tree = useRef<HTMLDivElement>(null),
    pointers = useRef(new Map<number, { x: number; y: number }>());
  const root = path.at(-1)?.id;
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const endpoint = "/api/organization?" +
        new URLSearchParams({
          mode,
          depth: String(depth),
          ...(root ? { root } : {}),
        });
    const defaultView = depth === 3 && !root && revision === 0;
    const applyCached = () => {
      const cached = defaultView ? getVerifiedPageData<Data>(endpoint) : null;
      if (!abort.signal.aborted && cached) { setData(cached); setLoading(false); }
      return !!cached;
    };
    const unsubscribe = subscribeVerifiedPageData(() => { if (defaultView && !getVerifiedPageData<Data>(endpoint)) { setData(null); setLoading(true); } else applyCached(); });
    const fetchLatest = () => fetchPageData(endpoint, abort.signal)
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
    if (defaultView) {
      if (!applyCached()) { setData(null); void preloadPages().then(() => { if (!abort.signal.aborted && !applyCached()) void fetchLatest(); }); }
    } else void fetchLatest();
    return () => { abort.abort(); unsubscribe(); };
  }, [mode, depth, root, revision]);
  function center() {
    const v = viewport.current?.getBoundingClientRect(),
      t = tree.current?.getBoundingClientRect(),
      r = tree.current?.querySelector(".org-root")?.getBoundingClientRect();
    if (v && t && r)
      setPan({
        x: v.width / 2 - (r.left - t.left + r.width / 2),
        y: 30 - (r.top - t.top),
      });
  }
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    const id = requestAnimationFrame(center);
    return () => cancelAnimationFrame(id);
  }, [data, full, loading]);
  const clamp = (n: number) => Math.min(2.5, Math.max(0.15, n));
  function enter(node: Node) {
    setPath((p) => [...p, { id: node.id, name: node.name }]);
  }
  const byParent = new Map<string, Node[]>();
  for (const n of data?.nodes || []) {
    if (n.parent_id)
      byParent.set(n.parent_id, [...(byParent.get(n.parent_id) || []), n]);
  }
  function renderNode(node: Node, top = false): React.ReactNode {
    const children = byParent.get(node.id) || [];
    return (
      <div className="org-branch" key={node.id}>
        <button
          className={`org-card ${top ? "org-root" : ""}`}
          onClick={() => enter(node)}
          aria-label={tr("{0} 하위 조직 보기", {"0": node.name})}
        >
          <strong>{node.name}</strong>
          <span>ID {node.code}</span>
          <span>{tr("가입 ")}{new Date(node.created_at).toLocaleDateString(localeTag, { timeZone: 'Asia/Seoul' })}
          </span>
          <span>{tr("순구매 ")}{formatUsdt(node.sales, 0)} P</span>
          {node.referral_ordinal && <span>{tr("정회원 등록 ")}{node.referral_ordinal}{tr("번째 · ")}{node.rollup_generation ? tr("{0}대 롤업", {"0": node.rollup_generation}) : tr("직접 후원")}</span>}
          {node.status !== "active" && <span>{tr("이용 제한")}</span>}
          {node.has_children && !children.length && (
            <span>{tr("하위 조직 보기 ↓")}</span>
          )}
        </button>
        {children.length > 0 ? (
          <div className="org-children">
            {children.map((child) => renderNode(child))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <>
    <main className="commerce" aria-label={tr("조직도")}>
      {tr(error) && (
        <p role="alert" className="shop-error">
          {tr(error)}
        </p>
      )}
      {tr(notice) && (
        <p role="status" className="shop-success">
          {tr(notice)}
        </p>
      )}
      <div className="org-controls">
        <button
          aria-pressed={mode === "referral"}
          onClick={() => {
            setMode("referral");
            setPath([]);
          }}
        >{tr("추천")}</button>
        <button
          aria-pressed={mode === "sponsor"}
          onClick={() => {
            setMode("sponsor");
            setPath([]);
          }}
        >{tr("후원")}</button>
        <label><select aria-label={tr("표시 단계")}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          >
            {[3, 5, 10, 15, 20, 0].map((n) => (
              <option value={n} key={n}>
                {n ? n + tr("단계") : tr("전체 (최대 500명)")}
              </option>
            ))}
          </select>
        </label>
        <button aria-label={tr("새로고침")} onClick={() => setRevision((n) => n + 1)}><RefreshCw size={18} /></button>
      </div>
      {mode === "sponsor" && data && data.pending.length > 0 && (
        <section className="shop-editor">
          <h2>{tr("자동 배치 대기 (")}{data.pending.length})</h2>
          {data.pending.map(n => <p key={n.id}>{n.name} · {n.code} · {tr(n.placement_reason)}</p>)}
          {data.pendingTruncated && <p>{tr("최대 500명까지 표시됩니다.")}</p>}
        </section>
      )}
      <nav className="org-breadcrumbs" aria-label={tr("조직 경로")}>
        {path.length > 0 && <button onClick={() => setPath([])}>{tr("내 조직")}</button>}
        {path.map((p, i) => (
          <button
            key={`${p.id}-${i}`}
            onClick={() => setPath(path.slice(0, i + 1))}
          >
            › {p.name}
          </button>
        ))}
        {path.length > 0 && (
          <button onClick={() => setPath((p) => p.slice(0, -1))}>{tr("← 이전")}</button>
        )}
      </nav>
      <section className={`org-board ${full ? "org-fullscreen" : ""}`}>
        <div className="org-board-toolbar">
          <button aria-label={tr("축소")} onClick={() => setZoom((z) => clamp(z - 0.1))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button aria-label={tr("확대")} onClick={() => setZoom((z) => clamp(z + 0.1))}>+</button>
          <button
            onClick={() => {
              setZoom(1);
              requestAnimationFrame(center);
            }}
          >{tr("중앙 정렬")}</button>
          <button onClick={() => setFull(!full)}>
            {full ? tr("전체화면 닫기") : tr("전체화면")}
          </button>
        </div>
        {data?.truncated && (
          <p role="status">{tr("조회 한도 500명까지 표시했습니다. 회원을 눌러 하위 조직을 확인하세요.")}</p>
        )}
        <div
          className="org-viewport"
          ref={viewport}
          tabIndex={0}
          aria-label={tr("조직도 이동 영역")}
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
    </main>
    <BottomNav active="organization" />
    </>
  );
}
