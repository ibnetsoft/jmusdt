"use client";
import { BottomNav } from "./bottom-nav";
import { usePathname } from "next/navigation";

// Keep navigation available without showing loading text or stale balances.
export function RouteLoading({ active }: { active?: "wallet" | "shop" | "organization" | "activity" | "settings" }) {
  return <><main className="route-loading" aria-busy="true" /><BottomNav active={active} /></>;
}

export function RootRouteLoading() {
  const pathname = usePathname();
  if (pathname && (pathname.startsWith("/admin") || pathname.startsWith("/login") || pathname.startsWith("/reset-password") || pathname.startsWith("/auth"))) return null;
  return <RouteLoading active="wallet" />;
}
