import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../drizzle/schema";

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;
export type PostgresSql = ReturnType<typeof postgres>;

let _client: PostgresSql | undefined;
let _db: DrizzleDb | undefined;
let _currentUrl: string | undefined;

function stripSurroundingQuotes(value: string | undefined): string {
  const trimmed = value?.trim() || "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isTestRuntime(): boolean {
  return (
    process.env.VITEST === "true" ||
    Boolean(process.env.VITEST_POOL_ID) ||
    process.env.NODE_ENV === "test"
  );
}

export function resolveDatabaseUrl(connectionString?: string): string {
  const explicit = stripSurroundingQuotes(connectionString);
  if (explicit) {
    return explicit;
  }

  const testRuntime = isTestRuntime();
  const testUrl = stripSurroundingQuotes(process.env.TEST_DATABASE_URL);
  const prodUrl = stripSurroundingQuotes(process.env.DATABASE_URL);
  const migrationUrl = stripSurroundingQuotes(process.env.LOVABLE_DB_MIGRATION_URL);

  if (testRuntime) {
    if (!testUrl) {
      throw new Error(
        "[Drizzle] TEST_DATABASE_URL is not configured for test execution (fallback to DATABASE_URL is blocked to protect production).",
      );
    }
    if (prodUrl) {
      let sameTarget = testUrl === prodUrl;
      if (!sameTarget) {
        try {
          const parsedTest = new URL(testUrl);
          const parsedProd = new URL(prodUrl);
          const normHost = (h: string) => h.toLowerCase().replace("-pooler.", ".");
          sameTarget =
            normHost(parsedTest.hostname) === normHost(parsedProd.hostname) &&
            (parsedTest.port || "5432") === (parsedProd.port || "5432") &&
            parsedTest.pathname.replace(/^\/+/, "") === parsedProd.pathname.replace(/^\/+/, "");
        } catch {
          sameTarget = false;
        }
      }
      if (sameTarget) {
        throw new Error(
          "[Drizzle] TEST_DATABASE_URL targets the same host/database as DATABASE_URL. Refusing test connection to protect production.",
        );
      }
    }
    return testUrl;
  }

  const url = prodUrl || testUrl || migrationUrl || "";

  if (!url) {
    throw new Error(
      "[Drizzle] DATABASE_URL or TEST_DATABASE_URL is not configured. Provide a PostgreSQL connection string to initialize Drizzle.",
    );
  }

  return url;
}

function buildSslOption(url: string): boolean | "require" | { rejectUnauthorized: boolean } | undefined {
  if (url.includes("sslmode=disable")) return false;
  if (url.includes("sslmode=require") || url.includes("neon.tech") || url.includes("ssl=true")) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

function isPooledConnection(url: string): boolean {
  return url.includes("-pooler.") || url.includes(":6543/") || url.includes("pgbouncer=true");
}

function ensurePool(connectionString?: string): { client: PostgresSql; db: DrizzleDb; url: string } {
  const url = resolveDatabaseUrl(connectionString);

  if (_db && _client && _currentUrl === url) {
    return { client: _client, db: _db, url };
  }

  if (_client && _currentUrl !== url) {
    const staleClient = _client;
    _client = undefined;
    _db = undefined;
    staleClient.end({ timeout: 2 }).catch(() => {});
  }

  const sqlClient = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: !isPooledConnection(url),
    ssl: buildSslOption(url),
  });

  _client = sqlClient;
  _db = drizzle(sqlClient, { schema });
  _currentUrl = url;

  return { client: _client, db: _db, url };
}

/**
 * Returns the Drizzle ORM client connected to PostgreSQL via postgres-js.
 * Uses connectionString, DATABASE_URL, TEST_DATABASE_URL, or LOVABLE_DB_MIGRATION_URL.
 * Throws an explicit error if no connection string is configured.
 */
export function getDrizzleDb(connectionString?: string): DrizzleDb {
  return ensurePool(connectionString).db;
}

/**
 * Returns the underlying postgres-js SQL client bound to the same pool as Drizzle.
 */
export function getPostgresSql(connectionString?: string): PostgresSql {
  return ensurePool(connectionString).client;
}

/**
 * Executes a real PostgreSQL health probe (`SELECT 1`) and throws explicitly if unreachable.
 */
export async function verifyDatabaseConnection(connectionString?: string): Promise<{ ok: true }> {
  const sql = getPostgresSql(connectionString);
  await sql`SELECT 1 AS ok`;
  return { ok: true };
}

/**
 * Runs a callback inside a real PostgreSQL transaction using Drizzle ORM.
 */
export async function withDbTransaction<T>(
  fn: (tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0]) => Promise<T>,
  connectionString?: string,
): Promise<T> {
  const db = getDrizzleDb(connectionString);
  return db.transaction(fn);
}

/**
 * Gracefully close the PostgreSQL connection pool.
 */
export async function closeDrizzleDb(): Promise<void> {
  if (_client) {
    const client = _client;
    _client = undefined;
    _db = undefined;
    _currentUrl = undefined;
    await client.end({ timeout: 5 });
  }
}
