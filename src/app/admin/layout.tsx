import { Suspense } from "react";
import { AdminSidebar } from "@/components/admin-sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-layout"><Suspense fallback={<aside className="admin-sidebar" />}><AdminSidebar /></Suspense><div className="admin-route-content">{children}</div></div>;
}
