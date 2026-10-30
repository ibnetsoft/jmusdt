import { Suspense } from "react";
import { AdminApp } from "@/components/admin";
export default function Page() { return <Suspense fallback={null}><AdminApp /></Suspense>; }
