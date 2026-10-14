"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { ShieldCheck, KeyRound } from "lucide-react";
function browserAuth() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
export function SecuritySettings({ demo = false }: { demo?: boolean }) {
  const [factor, setFactor] = useState(""),
    [qr, setQr] = useState(""),
    [code, setCode] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function begin() {
    setBusy(true);
    setMessage("");
    try {
      if (demo) {
        setMessage("실제 계정을 연결하면 인증 앱을 등록할 수 있습니다.");
        return;
      }
      const auth = browserAuth();
      const { data, error } = await auth.auth.mfa.listFactors();
      if (error) throw error;
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) {
        setFactor(verified.id);
        return;
      }
      // Remove incomplete enrollments from earlier attempts, never verified factors.
      for (const pending of data.totp.filter((f) => f.status !== "verified"))
        await auth.auth.mfa.unenroll({ factorId: pending.id });
      const enrolled = await auth.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "JMUSDT Authenticator",
      });
      if (enrolled.error) throw enrolled.error;
      setFactor(enrolled.data.id);
      setQr(enrolled.data.totp.qr_code);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    try {
      const auth = browserAuth();
      const result = await auth.auth.mfa.challengeAndVerify({
        factorId: factor,
        code,
      });
      if (result.error) throw result.error;
      setMessage("2단계 인증이 완료되었습니다.");
      setFactor("");
      setQr("");
      setCode("");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="security-settings">
      <div>
        <ShieldCheck size={23} />
        <span>
          <strong>2단계 인증</strong>
          <small>인증 앱으로 계정을 보호하세요.</small>
        </span>
        <button onClick={() => void begin()} disabled={busy}>
          인증하기
        </button>
      </div>
      {factor ? (
        <div className="mfa-form">
          {qr ? (
            <img
              alt="인증 앱 등록 QR 코드"
              width={170}
              height={170}
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`}
            />
          ) : null}
          <label className="field">
            <span>인증 앱의 6자리 코드</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button
            className="primary"
            disabled={busy || code.length !== 6}
            onClick={() => void verify()}
          >
            <KeyRound size={16} />
            {busy ? "확인 중…" : "코드 확인"}
          </button>
        </div>
      ) : null}
      {message ? (
        <p className="field-hint" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
