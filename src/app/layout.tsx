import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteControls } from "@/components/site-controls";
export const metadata: Metadata = {
  title: "JMUSDT — Everyday wallet",
  description: "TRON USDT 중앙화 지갑",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "JMUSDT",
  },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#101010",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html:"try{var t=localStorage.getItem('jmusdt-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}"}} /></head>
      <body><SiteControls />{children}</body>
    </html>
  );
}
