"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "./i18n";
import "./shop.css";
import "./admin-announcements.css";

type Announcement = { id: string; title_ko: string; body_ko: string; title_en: string; body_en: string; title_ja: string; body_ja: string; created_at: string };
type Form = Pick<Announcement, "title_ko" | "body_ko" | "title_en" | "body_en" | "title_ja" | "body_ja">;
const emptyForm: Form = { title_ko: "", body_ko: "", title_en: "", body_en: "", title_ja: "", body_ja: "" };
const copy = {
  ko: { heading:"공지사항 관리", description:"회원에게 표시할 공지를 언어별로 작성해 전송합니다.", create:"새 공지 작성", title:"제목", body:"내용", send:"공지 전송", sending:"전송 중…", sent:"공지를 전송했습니다.", history:"전송한 공지", empty:"전송한 공지가 없습니다.", loading:"불러오는 중…", error:"공지사항을 불러오지 못했습니다.", submitError:"공지를 전송하지 못했습니다.", hint:"각 언어의 제목과 내용을 입력해 주세요.", confirm:"전체 회원에게 이 공지를 전송할까요?" },
  en: { heading:"Announcements", description:"Write an announcement in each language and send it to members.", create:"New announcement", title:"Title", body:"Message", send:"Send announcement", sending:"Sending…", sent:"Announcement sent.", history:"Sent announcements", empty:"No announcements have been sent.", loading:"Loading…", error:"Could not load announcements.", submitError:"Could not send announcement.", hint:"Enter a title and message in each language.", confirm:"Send this announcement to all members?" },
  ja: { heading:"お知らせ管理", description:"各言語でお知らせを作成し、会員に送信します。", create:"新しいお知らせ", title:"タイトル", body:"内容", send:"お知らせを送信", sending:"送信中…", sent:"お知らせを送信しました。", history:"送信済みのお知らせ", empty:"送信したお知らせはありません。", loading:"読み込み中…", error:"お知らせを読み込めませんでした。", submitError:"お知らせを送信できませんでした。", hint:"各言語のタイトルと内容を入力してください。", confirm:"このお知らせをすべての会員に送信しますか？" },
} as const;

export function AdminAnnouncements() {
  const { locale, localeTag } = useI18n();
  const t = copy[locale];
  const [form, setForm] = useState<Form>(emptyForm);
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const lock = useRef(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/announcements", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "load_failed");
    setItems(data.announcements);
  }, []);
  useEffect(() => { load().catch(() => setError("load_failed")).finally(() => setLoading(false)); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !window.confirm(t.confirm)) return;
    lock.current = true; setBusy(true); setError(""); setSuccess(false);
    try {
      const response = await fetch("/api/admin/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "submit_failed");
      setForm(emptyForm); setSuccess(true);
      await load().catch(() => setError("load_failed"));
    } catch (e) { setError(e instanceof Error ? e.message : "submit_failed"); }
    finally { lock.current = false; setBusy(false); }
  }
  const languages = [{ id: "ko", label: "한국어" }, { id: "en", label: "English" }, { id: "ja", label: "日本語" }] as const;
  return <main className="commerce admin-announcements">
    <p className="shop-kicker">ADMIN / ANNOUNCEMENTS</p><h1>{t.heading}</h1><p className="shop-muted">{t.description}</p>
    <form className="shop-editor announcement-form" onSubmit={submit}>
      <h2>{t.create}</h2><p className="shop-muted">{t.hint}</p>
      <div className="announcement-languages">{languages.map(({ id, label }) => <fieldset key={id}>
        <legend>{label}</legend>
        <label>{t.title}<input required maxLength={200} value={form[`title_${id}`]} onChange={event => setForm({ ...form, [`title_${id}`]: event.target.value })} /></label>
        <label>{t.body}<textarea required maxLength={10000} rows={6} value={form[`body_${id}`]} onChange={event => setForm({ ...form, [`body_${id}`]: event.target.value })} /></label>
      </fieldset>)}</div>
      <button className="shop-primary" disabled={busy} type="submit">{busy ? t.sending : t.send}</button>
      {error && <p className="shop-error" role="alert">{error === "load_failed" ? t.error : error === "submit_failed" ? t.submitError : error}</p>}
      {success && <p className="shop-success" role="status">{t.sent}</p>}
    </form>
    <section className="shop-editor announcement-history"><h2>{t.history}</h2>
      {loading ? <p className="shop-muted">{t.loading}</p> : items.length === 0 ? <p className="shop-muted">{t.empty}</p> : items.map(item => <article key={item.id}><strong>{item[`title_${locale}`]}</strong><p>{item[`body_${locale}`]}</p><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString(localeTag)}</time></article>)}
    </section>
  </main>;
}
