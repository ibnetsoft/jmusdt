import { Pool, type PoolClient } from "pg";
import { readFileSync } from "node:fs";
const globalDb = globalThis as unknown as { walletPool?: Pool };
export function database() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL 설정이 필요합니다.");
  return (globalDb.walletPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 8,
    ssl:
      process.env.DATABASE_SSL === "false"
        ? false
        : {
            rejectUnauthorized: true,
            ...(process.env.DATABASE_SSL_CA_FILE
              ? { ca: readFileSync(process.env.DATABASE_SSL_CA_FILE, "utf8") }
              : {}),
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
