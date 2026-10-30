"use client";
import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import "./shop.css";
export function TronApiSettings() {
  const { tr } = useI18n();
  const [key, setKey] = useState(""), [configured, setConfigured] = useState(false), [writable, setWritable] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  useEffect(() => { fetch("/api/admin/tron-api", { cache: "no-store" }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setConfigured(d.configured); setWritable(d.writable); }).catch(e => setError(e.message)); }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError(""); setMessage("");
    try { const r = await fetch("/api/admin/tron-api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setKey(""); setConfigured(true); setMessage("API 키를 저장했습니다."); } catch (e) { setError(e instanceof Error ? e.message : "저장 실패"); } finally { setBusy(false); }
  }
  return <main className="commerce"><p className="shop-kicker">ADMIN / TRON API</p><h1>{tr("TronGrid API 설정")}</h1><p className="shop-muted">{tr("TRON 네트워크 조회에 사용할 API 키를 등록합니다.")}</p><form className="shop-editor" onSubmit={save}><h2>{tr("API 키")}</h2><p>{configured ? tr("키가 등록되어 있습니다.") : tr("등록된 키가 없습니다.")}</p><label htmlFor="tron-api-key">{tr("새 API 키")}</label><input id="tron-api-key" type="password" autoComplete="off" required minLength={10} maxLength={200} value={key} onChange={e => setKey(e.target.value)} /><p className="shop-muted">{tr("보안을 위해 저장한 키는 다시 표시하지 않습니다. 변경하려면 새 키를 입력하세요. 최고관리자 2단계 인증이 필요합니다.")}</p><button disabled={busy || !writable}>{busy ? tr("확인 중…") : tr("키 저장")}</button>{!writable && <p role="status">{tr("서버의 암호화 설정을 확인해 주세요.")}</p>}{error && <p role="alert" className="shop-error">{tr(error)}</p>}{message && <p role="status" className="shop-success">{tr(message)}</p>}</form></main>;
}
