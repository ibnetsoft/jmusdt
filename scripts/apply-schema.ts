import "./load-env";
import { readFile } from "node:fs/promises";
import { database } from "../src/lib/db";
const pool = database();
try {
  await pool.query(
    await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
  );
  console.log("Wallet schema applied.");
} finally {
  await pool.end();
}
