import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LanguageProvider } from "@/components/i18n";
import { serverI18n } from "@/lib/i18n-server";
const baseMetadata: Metadata = {
  title: "WU — Everyday wallet",
  description: "TRON USDT 중앙화 지갑",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "WU",
  },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};
export async function generateMetadata(): Promise<Metadata> {
  const { tr } = await serverI18n();
  return { ...baseMetadata, description: tr("TRON USDT 중앙화 지갑") };
}
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#101010",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale } = await serverI18n();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html:"try{var t=localStorage.getItem('jmusdt-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}"}} /></head>
      <body><LanguageProvider initialLocale={locale}>{children}</LanguageProvider></body>
    </html>
  );
}
