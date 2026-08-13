import { defineConfig } from "drizzle-kit";

// Migrations run against the direct connection (:5432), not the transaction
// pooler (:6543) — DDL and the pooler's transaction mode do not mix.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
