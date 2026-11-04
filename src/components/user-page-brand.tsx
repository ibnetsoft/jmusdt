"use client";
import { usePathname } from "next/navigation";
import { Brand } from "./shared";

// Wallet views already render the same brand inside their own header.
export function UserPageBrand() {
  const pathname = usePathname();
  if (!pathname || !(pathname === "/shop" || pathname.startsWith("/shop/") || ["/organization", "/points", "/rewards", "/notifications"].includes(pathname))) return null;
  return <div className="user-page-brand"><Brand /></div>;
}
