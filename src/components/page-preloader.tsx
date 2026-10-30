"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { preloadPages } from "@/lib/preload-pages";
export function PagePreloader() {
  const pathname = usePathname();
  const router = useRouter();
  const started = useRef(false);
  useEffect(() => {
    if (!pathname || !(["/", "/activity", "/mypage", "/organization", "/points", "/rewards"].includes(pathname) || pathname === "/shop" || pathname.startsWith("/shop/"))) return;
    for (const route of ["/", "/shop", "/organization", "/activity", "/mypage", "/points"]) router.prefetch(route);
    if (!started.current) { started.current = true; void preloadPages(); }
  }, [pathname, router]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (started.current) void preloadPages(); }, 60000);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
