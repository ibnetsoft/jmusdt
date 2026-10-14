import { Login } from "@/components/login";
import { isDemo } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Login demo={isDemo()} />;
}
