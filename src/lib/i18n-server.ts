import { cookies } from "next/headers";
import { cache } from "react";
import { localeCookie, localeTags, supportedLocale, translator } from "./i18n";

export const serverI18n = cache(async () => {
  const locale = supportedLocale((await cookies()).get(localeCookie)?.value);
  return { locale, localeTag: localeTags[locale], tr: translator(locale) };
});
