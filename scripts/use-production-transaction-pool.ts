import "./load-env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";

assert.ok(process.argv.includes("--apply"), "Explicit --apply required");
const project = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
assert.equal(project.projectId, "prj_rGzJ6QW5GivVjOKwmh5A4qlzsLzo");
assert.equal(project.orgId, "team_QJSGa0a8xgPhaxMYZZGQqISB");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "aws-0-ap-northeast-2.pooler.supabase.com");
assert.ok(decodeURIComponent(url.username).endsWith(".thxpejttykcdgvjjgwxv"));
assert.ok(url.port === "5432" || url.port === "6543");
url.port = "6543";
const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 10000, ssl: { rejectUnauthorized: true, ca: readFileSync("certs/supabase-prod-ca-2021.crt", "utf8") } });
try {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(9692043)");
    const result = await connection.query("SELECT price::text,retail_price::text FROM shop_products WHERE id=$1", ["3140db21-c190-442b-a12e-84f11b3d9734"]);
    assert.deepEqual(result.rows[0], { price: "88000000000", retail_price: "98000000000" });
    await connection.query("ROLLBACK");
    console.log("Verified TLS, project identity and transaction/advisory-lock compatibility on port 6543.");
  } finally { connection.release(); }
} finally { await pool.end(); }
// Pass the credential only over stdin; never include it in arguments or output.
try {
  const output = execFileSync(process.platform === "win32" ? "vercel.cmd" : "vercel", ["env", "update", "DATABASE_URL", "production", "--yes", "--sensitive", "--scope", project.orgId], { input: url.toString(), encoding: "utf8", shell: process.platform === "win32", stdio: ["pipe", "pipe", "pipe"] });
  console.log(output.replaceAll(url.toString(), "[redacted]").trim());
  console.log("Production DATABASE_URL updated to the transaction pool. Redeploy to activate.");
} catch (error) {
  const status = (error as { status?: number }).status;
  throw new Error("Environment update failed; no credential output was emitted. CLI exit " + status);
}
