"use client";
import { History, Network, Settings, ShoppingBag, Wallet } from "lucide-react";
import { useI18n } from "./i18n";

type Menu = "wallet" | "shop" | "organization" | "activity" | "settings";
const items = [
  { id: "wallet", label: "지갑", href: "/", icon: Wallet },
  { id: "shop", label: "쇼핑몰", href: "/shop", icon: ShoppingBag },
  { id: "organization", label: "조직도", href: "/organization", icon: Network },
  { id: "activity", label: "내역", href: "/activity", icon: History },
  { id: "settings", label: "설정", href: "/mypage", icon: Settings },
] as const;
export function BottomNav({ active, onWalletView }: { active?: Menu; onWalletView?: (view: "home" | "activity" | "settings") => void }) {
  const { tr } = useI18n();
  return <nav className="bottom-nav" aria-label={tr("모바일 메뉴")}>
    {items.map(item => <a key={item.id} href={item.href} className={active === item.id ? "active" : ""} aria-current={active === item.id ? "page" : undefined} onClick={event => {
      if (onWalletView && (item.id === "wallet" || item.id === "activity" || item.id === "settings")) {
        event.preventDefault(); onWalletView(item.id === "wallet" ? "home" : item.id);
      }
    }}><item.icon size={20} /><span>{tr(item.label)}</span></a>)}
  </nav>;
}
