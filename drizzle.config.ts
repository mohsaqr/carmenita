import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    // CARMENITA_DB points at the live DB in production (outside the repo).
    url: process.env.CARMENITA_DB || "./carmenita.db",
  },
  verbose: true,
  strict: true,
} satisfies Config;
