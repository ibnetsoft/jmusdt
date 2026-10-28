import "../scripts/load-env";
import { setTimeout as delay } from "node:timers/promises";
import { database } from "../src/lib/db";
import { runSweepOnce } from "../src/lib/sweep-worker";
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
console.log("TRON sweep worker started; only approved jobs can progress.");
while (!stopped) {
  try {
    const r = await runSweepOnce();
    if (r.state === "retry") console.error(r.error);
  } catch {
    console.error("Sweep worker configuration / DB check failed.");
  }
  await delay(5000);
}
await database().end();
