"use client";
import { useI18n } from "./i18n";

import { useEffect, useRef, useState } from "react";
import { Brand } from "./shared";
import { SecuritySettings } from "./security";
export function ResetPassword() {
  const { tr } = useI18n();
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [mfa, setMfa] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/auth/password", { cache: "no-store", signal: abort.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setReady(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setMessage(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    if (password !== confirmation) {
      setMessage("비밀번호 확인값이 일치하지 않습니다.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (r.status === 403 && d.error.includes("2단계")) setMfa(true);
        throw new Error(d.error);
      }
      setPassword("");
      setConfirmation("");
      location.href = "/login?reset=1";
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "비밀번호 변경 실패");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-art">
        <Brand />
        <div>
          <h1>{tr("새로운 비밀번호.")}<br />{tr("안전한 내 지갑.")}</h1>
        </div>
        <span>JMUSDT / ACCOUNT SECURITY</span>
      </section>
      <section className="login-form">
        <p className="eyebrow">JMUSDT / PASSWORD RESET</p>
        <h2>{tr("비밀번호 재설정")}</h2>
        <p>{tr("12자 이상의 새 비밀번호를 입력하세요. 변경 후 모든 기기에서 다시 로그인해야 합니다.")}</p>
        {loading ? (
          <p role="status">{tr("재설정 링크를 확인하는 중…")}</p>
        ) : (
          ready && (
            <form onSubmit={submit}>
              <fieldset
                disabled={busy}
                style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
              >
                <label className="field">
                  <span>{tr("새 비밀번호")}</span>
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>{tr("새 비밀번호 확인")}</span>
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
                <button type="submit" className="primary">
                  {busy ? tr("변경 중…") : tr("비밀번호 변경")}
                </button>
              </fieldset>
            </form>
          )
        )}
        {tr(message) && (
          <p role="status" className="form-error">
            {tr(message)}
          </p>
        )}
        {mfa && <SecuritySettings />}
        <a href="/login" className="text-button">{tr("로그인 / 재설정 메일 다시 요청")}</a>
      </section>
    </main>
  );
}
