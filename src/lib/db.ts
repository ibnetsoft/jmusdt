import { Pool, type PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const globalDb = globalThis as unknown as { walletPool?: Pool };
export function database() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL 설정이 필요합니다.");
  const host = new URL(process.env.DATABASE_URL).hostname;
  const caFile =
    process.env.DATABASE_SSL_CA_FILE ||
    (host.endsWith(".pooler.supabase.com") || host.endsWith(".supabase.co")
      ? resolve(process.cwd(), "certs/supabase-prod-ca-2021.crt")
      : undefined);
  return (globalDb.walletPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 10000,
    ssl:
      process.env.DATABASE_SSL === "false"
        ? false
        : {
            rejectUnauthorized: true,
            ...(caFile ? { ca: readFileSync(caFile, "utf8") } : {}),
          },
  }));
}
export async function transaction<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
