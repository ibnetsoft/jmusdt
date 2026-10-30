"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Activity, ArrowUpRight, BadgePercent, ClipboardList, Coins, Image, LayoutDashboard, ShieldCheck, ShoppingBag, Users, Wallet } from "lucide-react";
import { Brand } from "./shared";
import { useI18n } from "./i18n";

const items = [
  { href: "/admin", label: "대시보드", icon: LayoutDashboard },
  { href: "/admin?tab=withdrawals", label: "출금 관리", icon: ArrowUpRight },
  { href: "/admin?tab=transactions", label: "거래 원장", icon: Activity },
  { href: "/admin?tab=users", label: "회원 관리", icon: Users },
  { href: "/admin?tab=operations", label: "지갑 운영", icon: Wallet },
  { href: "/admin?tab=audit", label: "감사 로그", icon: ShieldCheck },
  { href: "/admin/orders", label: "주문 관리", icon: ClipboardList },
  { href: "/admin/sweeps", label: "USDT 모으기", icon: Coins },
  { href: "/admin/exchange-rate", label: "포인트 전환 비율", icon: BadgePercent },
  { href: "/admin/marketing", label: "마케팅 관리", icon: Activity },
  { href: "/admin/shop", label: "상품 관리", icon: ShoppingBag },
  { href: "/admin/grades", label: "회원등급 관리", icon: Users },
  { href: "/admin/branding", label: "로고 설정", icon: Image },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { tr } = useI18n();
  const current = pathname === "/admin" && params.get("tab") ? `/admin?tab=${params.get("tab")}` : pathname;
  return <aside className="admin-sidebar">
    <Brand admin />
    <div className="console-label">WORKSPACE / WU</div>
    <nav aria-label={tr("관리자 메뉴")}>
      {items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={current === href ? "active" : ""} aria-current={current === href ? "page" : undefined} aria-label={tr(label)} title={tr(label)}><Icon size={18} /><span>{tr(label)}</span></Link>)}
    </nav>
    <div className="admin-sidebar-footer"><div><ShieldCheck size={17}/><span>{tr("관리자 콘솔")}</span></div><Link href="/">{tr("사용자 지갑 열기")} <ArrowUpRight size={15}/></Link></div>
  </aside>;
}
