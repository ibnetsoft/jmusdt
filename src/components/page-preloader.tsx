"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { preloadPages } from "@/lib/preload-pages";
export function PagePreloader() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || !(["/", "/activity", "/mypage", "/organization", "/points", "/rewards"].includes(pathname) || pathname === "/shop" || pathname.startsWith("/shop/"))) return;
    void preloadPages();
  }, [pathname]);
  return null;
}
