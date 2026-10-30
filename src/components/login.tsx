"use client";
import { useI18n } from "./i18n";

import { useState, useRef } from "react";
import { ArrowRight, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Brand, Token } from "./shared";
import { notifyAuthChange } from "@/lib/preload-pages";
export function Login({
  demo,
  initialMessage = "",
  initialReferralCode = "",
}: {
  demo: boolean;
  initialMessage?: string;
  initialReferralCode?: string;
}) {
  const { tr } = useI18n();
  const [signup, setSignup] = useState(Boolean(initialReferralCode)),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [message, setMessage] = useState(initialMessage),
    [busy, setBusy] = useState(false);
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const [forgot, setForgot] = useState(false),
    [pending, setPending] = useState(false);
  const lock = useRef(false);
  async function sendEmail(action: "resend" | "recovery") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMessage(d.message);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "메일 요청 실패");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (forgot) {
      await sendEmail("recovery");
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: signup ? "signup" : "login",
          email,
          password,
          name: name || undefined,
          referralCode: signup ? referralCode.trim() || undefined : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (body.confirmationRequired) {
        setMessage("인증 이메일을 보냈습니다. 이메일 인증 후 로그인해 주세요.");
        setPending(true);
        setPassword("");
      } else { notifyAuthChange(); location.href = "/"; }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <main className="login-layout">
      <section className="login-art">
        <Brand />
        <div>
          <Token />
          <h1>
            Your money.
            <br />
            Your everyday.
          </h1>
          <p>{tr("당신의 일상을 위한")}<br />{tr("더 간편한 USDT 지갑.")}</p>
        </div>
        <span>WU / TRON NETWORK</span>
      </section>
      <section className="login-form">
        <p className="eyebrow">WELCOME TO WU</p>
        <h2>
          {forgot
            ? tr("비밀번호 찾기.")
            : signup
              ? tr("새로운 시작.")
              : tr("다시 만나 반가워요.")}
        </h2>
        <p>
          {forgot
            ? tr("가입한 이메일로 비밀번호 재설정 링크를 보내드립니다.")
            : signup
              ? tr("나만의 지갑을 만들어 보세요.")
              : tr("로그인하고 내 지갑을 확인하세요.")}
        </p>
        <form onSubmit={submit}>
          {signup && !forgot ? (
            <label className="field">
              <span>{tr("이름")}</span>
              <input
                required
                maxLength={60}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          ) : null}
          {signup && !forgot && (
            <label className="field">
              <span>{tr("추천 코드 (선택)")}</span>
              <input
                maxLength={12}
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                placeholder={tr("추천받은 코드를 입력하세요")}
              />
              <small>{tr("가입 후 추천 관계는 변경할 수 없습니다.")}</small>
            </label>
          )}
          <label className="field">
            <span>{tr("이메일")}</span>
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </label>
          {!forgot && (
            <label className="field">
              <span>{tr("비밀번호")}</span>
              <input
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete={signup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tr("12자 이상 입력")}
              />
            </label>
          )}
          {message ? (
            <p className="form-error" role="status">
              {tr(message)}
            </p>
          ) : null}
          <button className="primary" disabled={busy}>
            {busy
              ? tr("처리 중…")
              : forgot
                ? tr("재설정 메일 보내기")
                : signup
                  ? tr("회원가입")
                  : tr("로그인")}
            <ArrowRight size={18} />
          </button>
        </form>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setSignup(forgot ? false : !signup);
            setForgot(false);
            setPending(false);
            setMessage("");
          }}
        >
          {forgot
            ? tr("로그인으로 돌아가기")
            : signup
              ? tr("이미 계정이 있나요? 로그인")
              : tr("계정이 없나요? 회원가입")}
        </button>
        {!forgot && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setForgot(true);
              setSignup(false);
              setPending(false);
              setPassword("");
              setMessage("");
            }}
          >{tr("비밀번호를 잊으셨나요?")}</button>
        )}
        {!forgot && (
          <button
            className="text-button"
            disabled={busy || !email.trim()}
            onClick={() => void sendEmail("resend")}
          >
            {pending ? tr("인증 메일 다시 보내기") : tr("회원가입 인증 메일 재발송")}
          </button>
        )}
        {demo ? (
          <a href="/" className="demo-link">{tr("데모 지갑 둘러보기 ")}<ArrowUpRight size={17} />
          </a>
        ) : null}
        <p className="login-secure">
          <ShieldCheck size={16} />{tr("TRON · TRC20 USDT 전용")}</p>
      </section>
    </main>
  );
}
