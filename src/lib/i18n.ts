import { messages } from "./i18n-messages";

export const locales = ["ko", "en", "ja"] as const;
export type Locale = typeof locales[number];
export const localeCookie = "jmusdt-locale";
export const localeTags: Record<Locale, string> = { ko: "ko-KR", en: "en-US", ja: "ja-JP" };
export function supportedLocale(value: unknown): Locale {
  return value === "en" || value === "ja" ? value : "ko";
}
export type TranslationValues = Record<string, unknown>;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const templates = Object.keys(messages).filter(key => /\{\d+\}/.test(key)).sort((a, b) => b.length - a.length).map(key => ({
  key,
  tokens: [...key.matchAll(/\{(\d+)\}/g)].map(match => match[1]),
  pattern: new RegExp("^" + key.split(/\{\d+\}/).map(escapeRegex).join("(.+?)") + "$", "s"),
}));
export function translate(locale: Locale, message: string | null | undefined, values?: TranslationValues, depth = 0): string {
  if (!message) return "";
  const key = message.trim(), entry = messages[key];
  if (!key) return message;
  let result = locale === "ko" ? key : entry?.[locale === "en" ? 0 : 1] ?? key;
  // Canonical server messages may already contain interpolated amounts or IDs.
  if (locale !== "ko" && !entry && depth < 3 && /[가-힣]/.test(key)) {
    for (const template of templates) {
      const match = template.pattern.exec(key);
      if (!match) continue;
      result = translate(locale, template.key, Object.fromEntries(template.tokens.map((token, i) => [token, translate(locale, match[i + 1], undefined, depth + 1)])), depth + 1);
      break;
    }
  }
  if (values) result = result.replace(/\{([^{}]+)\}/g, (token, name: string) => Object.hasOwn(values, name) ? String(values[name] ?? "") : token);
  return (message.match(/^\s*/)?.[0] ?? "") + result + (message.match(/\s*$/)?.[0] ?? "");
}
export function translator(locale: Locale) {
  return (message: string | null | undefined, values?: TranslationValues) => translate(locale, message, values);
}
