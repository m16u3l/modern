import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * The client is created lazily and cached on globalThis: creating it at module
 * scope would fail the build when DATABASE_URL is absent, and serverless
 * invocations reuse the module between warm requests.
 */
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
  drizzleDb?: Db;
};

export function getDb(): Db {
  if (globalForDb.drizzleDb) return globalForDb.drizzleDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  // Supabase's transaction pooler does not support prepared statements.
  const client =
    globalForDb.pgClient ?? postgres(connectionString, { prepare: false, max: 1 });

  const db = drizzle({ client, schema });
  globalForDb.pgClient = client;
  globalForDb.drizzleDb = db;
  return db;
}

export { schema };
