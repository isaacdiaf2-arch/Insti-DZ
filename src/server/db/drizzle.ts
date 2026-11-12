import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../drizzle/schema";

let _client: ReturnType<typeof postgres> | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Returns an independent Drizzle ORM client connected via postgres-js.
 * Strictly uses connectionString or TEST_DATABASE_URL.
 * Does not import or touch Supabase credentials.
 */
export function getDrizzleDb(connectionString?: string) {
  const url = connectionString || process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "[Drizzle] TEST_DATABASE_URL is not configured. Provide an independent PostgreSQL connection string to initialize Drizzle.",
    );
  }

  if (!_db) {
    _client = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : false,
    });
    _db = drizzle(_client, { schema });
  }

  return _db;
}

/**
 * Gracefully close the independent connection pool.
 */
export async function closeDrizzleDb() {
  if (_client) {
    await _client.end();
    _client = undefined;
    _db = undefined;
  }
}
