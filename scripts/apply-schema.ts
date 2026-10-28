import "./load-env";
import { readFile } from "node:fs/promises";
import { database } from "../src/lib/db";
const pool = database();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
  );
  await client.query(
    await readFile(new URL("../db/commerce.sql", import.meta.url), "utf8"),
  );
  await client.query(
    await readFile(new URL("../db/points.sql", import.meta.url), "utf8"),
  );
  await client.query(
    await readFile(new URL("../db/refunds.sql", import.meta.url), "utf8"),
  );
  await client.query(
    await readFile(
      new URL("../db/product-content.sql", import.meta.url),
      "utf8",
    ),
  );
  await client.query(
    await readFile(
      new URL("../db/product-storage.sql", import.meta.url),
      "utf8",
    ),
  );
  await client.query(
    await readFile(new URL("../db/organization.sql", import.meta.url), "utf8"),
  );
  await client.query("COMMIT");
  console.log("Wallet schema applied.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
