import { api, identity } from "@/lib/http";
import { isDemo } from "@/lib/supabase";
import { demoWallet } from "@/lib/demo";
import { walletSnapshot } from "@/lib/wallet-service";
export async function GET() {
  return api(async () =>
    isDemo() ? demoWallet : walletSnapshot((await identity()).profile),
  );
}
