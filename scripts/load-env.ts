import nextEnv from "@next/env";

// Match Next.js precedence: process env > .env.local > .env.
// Shared CLI entrypoints must read the user's base .env too.
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
