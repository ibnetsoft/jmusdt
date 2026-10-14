import { api, identity, checkOrigin } from "@/lib/http";
import { provisionAddress } from "@/lib/wallet-service";
export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const { user } = await identity();
    return { address: await provisionAddress(user.id) };
  });
}
