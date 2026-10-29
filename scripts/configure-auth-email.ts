import "./load-env";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Credentials stay in an ignored local file and request memory; never log bodies.
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(
  ".",
)[0];
assert.equal(project, "thxpejttykcdgvjjgwxv", "Unexpected Supabase project");
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token)
  throw new Error(
    "SUPABASE_ACCESS_TOKEN management credential is required; a service-role key cannot configure SMTP.",
  );
const file = process.argv
  .find((v) => v.startsWith("--mail-config="))
  ?.slice("--mail-config=".length);
if (!file) throw new Error("Pass --mail-config=<ignored private JSON file>");
const entries = JSON.parse(await readFile(file, "utf8")) as {
  key: string;
  value: string;
}[];
const value = (key: string) => entries.find((v) => v.key === key)?.value;
const from = value("EMAIL_FROM") || "",
  password = value("RESEND_API_KEY");
const address = from.match(/<([^<>]+)>/)?.[1] || from.trim();
assert.match(address, /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/);
assert.ok(password?.startsWith("re_"), "Missing Resend SMTP password");
const endpoint = `https://api.supabase.com/v1/projects/${project}/config/auth`;
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
async function config(method = "GET", body?: unknown) {
  const r = await fetch(endpoint, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok)
    throw new Error(
      `Auth configuration ${method} failed (${r.status}); response body suppressed.`,
    );
  return await r.json();
}
const current = await config();
const template = (recovery: boolean) =>
  `<h2>WU ${recovery ? "비밀번호 재설정" : "이메일 인증"}</h2><p>${recovery ? "아래 버튼을 눌러 새 비밀번호를 설정하세요." : "아래 버튼을 눌러 이메일 인증을 완료하세요."}</p><p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${recovery ? "recovery" : "signup"}">${recovery ? "비밀번호 재설정" : "이메일 인증"}</a></p><p>요청하지 않았다면 이 메일을 무시하세요.</p>`;
const site = "https://www.jmusdt.com";
const allowed = new Set<string>(
  (current.uri_allow_list || "").split(",").filter(Boolean),
);
for (const host of [site, "https://jmusdt.com", "http://127.0.0.1:3000"])
  allowed.add(host + "/auth/callback");
const patch = {
  external_email_enabled: true,
  mailer_autoconfirm: false,
  smtp_host: "smtp.resend.com",
  smtp_port: "465",
  smtp_user: "resend",
  smtp_pass: password,
  smtp_admin_email: address,
  smtp_sender_name: "WU",
  site_url: site,
  uri_allow_list: [...allowed].join(","),
  mailer_subjects_confirmation: "[WU] 회원가입 이메일 인증",
  mailer_subjects_recovery: "[WU] 비밀번호 재설정",
  mailer_templates_confirmation_content: template(false),
  mailer_templates_recovery_content: template(true),
};
if (!process.argv.includes("--apply")) {
  console.log(
    "Auth configuration access verified. Prepared SMTP, canonical site URL and confirmation/recovery templates; no settings changed. Pass --apply to apply.",
  );
} else {
  await config("PATCH", patch);
  const saved = await config();
  for (const [key, expected] of Object.entries(patch)) {
    if (key === "smtp_pass") continue; // Management API may mask secrets.
    assert.equal(
      saved[key],
      expected,
      `Auth configuration verification failed: ${key}`,
    );
  }
  console.log(
    "Resend SMTP, confirmation required, site URL and both mail templates applied and read-back verified.",
  );
}
