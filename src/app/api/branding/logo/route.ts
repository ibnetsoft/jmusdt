import { database } from "@/lib/db";
export const runtime="nodejs";
export async function GET() {
  try {
    const row=(await database().query("SELECT logo_png FROM app_branding WHERE id=true")).rows[0];
    if (!row) return new Response(null,{status:404});
    return new Response(new Uint8Array(row.logo_png),{headers:{"Content-Type":"image/png","Cache-Control":"public, max-age=0, must-revalidate","X-Content-Type-Options":"nosniff"}});
  } catch { return new Response(null,{status:503,headers:{"Cache-Control":"no-store"}}); }
}
