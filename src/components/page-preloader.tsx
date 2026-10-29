"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { preloadPages } from "@/lib/preload-pages";
export function PagePreloader() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!pathname || !(["/", "/activity", "/mypage", "/organization", "/points", "/rewards"].includes(pathname) || pathname === "/shop" || pathname.startsWith("/shop/"))) return;
    for (const route of ["/", "/shop", "/organization", "/activity", "/mypage", "/points"]) router.prefetch(route);
    void preloadPages();
  }, [pathname, router]);
  return null;
}
