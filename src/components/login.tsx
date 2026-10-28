"use client";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Brand, Token } from "./shared";
export function Login({
  demo,
  initialMessage = "",
  initialReferralCode = "",
}: {
  demo: boolean;
  initialMessage?: string;
  initialReferralCode?: string;
}) {
  const [signup, setSignup] = useState(Boolean(initialReferralCode)),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [message, setMessage] = useState(initialMessage),
    [busy, setBusy] = useState(false);
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
      if (body.confirmationRequired)
        setMessage("인증 이메일을 보냈습니다. 이메일 인증 후 로그인해 주세요.");
      else location.href = "/";
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
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
          <p>
            당신의 일상을 위한
            <br />더 간편한 USDT 지갑.
          </p>
        </div>
        <span>JMUSDT / TRON NETWORK</span>
      </section>
      <section className="login-form">
        <p className="eyebrow">WELCOME TO JMUSDT</p>
        <h2>{signup ? "새로운 시작." : "다시 만나 반가워요."}</h2>
        <p>
          {signup
            ? "나만의 지갑을 만들어 보세요."
            : "로그인하고 내 지갑을 확인하세요."}
        </p>
        <form onSubmit={submit}>
          {signup ? (
            <label className="field">
              <span>이름</span>
              <input
                required
                maxLength={60}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          ) : null}
          {signup && (
            <label className="field">
              <span>추천 코드 (선택)</span>
              <input
                maxLength={12}
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                placeholder="추천받은 코드를 입력하세요"
              />
              <small>가입 후 추천 관계는 변경할 수 없습니다.</small>
            </label>
          )}
          <label className="field">
            <span>이메일</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <label className="field">
            <span>비밀번호</span>
            <input
              type="password"
              required
              minLength={12}
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="12자 이상 입력"
            />
          </label>
          {message ? (
            <p className="form-error" role="status">
              {message}
            </p>
          ) : null}
          <button className="primary" disabled={busy}>
            {busy ? "처리 중…" : signup ? "회원가입" : "로그인"}
            <ArrowRight size={18} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setSignup(!signup);
            setMessage("");
          }}
        >
          {signup ? "이미 계정이 있나요? 로그인" : "계정이 없나요? 회원가입"}
        </button>
        {demo ? (
          <a href="/" className="demo-link">
            데모 지갑 둘러보기 <ArrowUpRight size={17} />
          </a>
        ) : null}
        <p className="login-secure">
          <ShieldCheck size={16} />
          TRON · TRC20 USDT 전용
        </p>
      </section>
    </main>
  );
}
