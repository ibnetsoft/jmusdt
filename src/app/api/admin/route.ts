import { api, identity } from "@/lib/http";
import { isDemo } from "@/lib/supabase";
import { demoAdmin } from "@/lib/demo";
import { adminSnapshot } from "@/lib/wallet-service";
export async function GET() {
  return api(async () => {
    if (isDemo()) return demoAdmin;
    await identity(true);
    return adminSnapshot();
  });
}
