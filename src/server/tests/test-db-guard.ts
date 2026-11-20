import type { PostgresSql } from "../db/drizzle";

export interface ParsedPostgresTarget {
  protocol: string;
  host: string;
  port: string;
  database: string;
  sslmode: string | null;
}

function stripQuotes(value: string | undefined): string {
  const trimmed = value?.trim() || "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Parses a PostgreSQL connection URL without retaining or exposing credentials.
 */
export function parsePostgresTarget(connectionString: string): ParsedPostgresTarget {
  const normalized = stripQuotes(connectionString);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("[TestDBGuard] Invalid PostgreSQL connection URL format.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`[TestDBGuard] Unsupported database protocol "${parsed.protocol}". Expected postgres:// or postgresql://.`);
  }

  return {
    protocol: parsed.protocol.replace(":", ""),
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    database: parsed.pathname.replace(/^\/+/, "") || "postgres",
    sslmode: parsed.searchParams.get("sslmode"),
  };
}

/**
 * Returns true if two PostgreSQL connection strings target the same host, port, and database.
 * Normalizes Neon "-pooler." suffixes so pooled and direct endpoints for the same branch are detected.
 */
export function isSameDatabaseTarget(urlA: string, urlB: string): boolean {
  const a = stripQuotes(urlA);
  const b = stripQuotes(urlB);
  if (!a || !b) return false;
  if (a === b) return true;

  try {
    const parsedA = parsePostgresTarget(a);
    const parsedB = parsePostgresTarget(b);
    const normHost = (h: string) => h.replace("-pooler.", ".");
    return (
      normHost(parsedA.host) === normHost(parsedB.host) &&
      parsedA.port === parsedB.port &&
      parsedA.database === parsedB.database
    );
  } catch {
    return false;
  }
}

/**
 * Strictly resolves the live test database URL from TEST_DATABASE_URL ONLY.
 * NEVER falls back to DATABASE_URL or LOVABLE_DB_MIGRATION_URL.
 * Throws explicitly if TEST_DATABASE_URL appears to point at production or matches DATABASE_URL.
 */
export function resolveVerifiedTestDatabaseUrl(): string | null {
  const testUrl = stripQuotes(process.env.TEST_DATABASE_URL);
  if (!testUrl) {
    return null;
  }

  const prodUrl = stripQuotes(process.env.DATABASE_URL);
  if (prodUrl && isSameDatabaseTarget(testUrl, prodUrl)) {
    throw new Error(
      "[TestDBGuard] Refusing to execute tests: TEST_DATABASE_URL targets the same host/database as DATABASE_URL (production isolation safeguard).",
    );
  }

  const target = parsePostgresTarget(testUrl);

  const declaredBranch = stripQuotes(process.env.TEST_DB_BRANCH);
  if (declaredBranch && declaredBranch !== "insti-dz-test") {
    throw new Error(
      `[TestDBGuard] Refusing to execute tests: TEST_DB_BRANCH="${declaredBranch}" is not "insti-dz-test".`,
    );
  }

  if (/\bprod(uction)?\b/i.test(target.database) && !/\btest\b/i.test(target.database)) {
    throw new Error(
      `[TestDBGuard] Refusing to execute tests: target database "${target.database}" looks like a production database.`,
    );
  }

  return testUrl;
}

/**
 * Pre-write runtime safety check executed on the live test branch before CRUD/RLS/migration probes.
 * Returns non-sensitive connection metadata (never credentials).
 */
export async function verifyTestBranchBeforeWrite(
  sql: PostgresSql,
  options: { requireNonBypassRls?: boolean } = {},
): Promise<{
  database: string;
  role: string;
  rolbypassrls: boolean;
  rolsuper: boolean;
}> {
  const rows = await sql`
    SELECT
      current_database() AS database,
      current_user AS role,
      r.rolbypassrls,
      r.rolsuper
    FROM pg_roles r
    WHERE r.rolname = current_user
  `;

  const info = rows[0];
  if (!info) {
    throw new Error("[TestDBGuard] Failed to inspect active PostgreSQL role metadata.");
  }

  const database = String(info.database);
  const role = String(info.role);
  const rolbypassrls = Boolean(info.rolbypassrls);
  const rolsuper = Boolean(info.rolsuper);

  if (/\bprod(uction)?\b/i.test(database) && !/\btest\b/i.test(database)) {
    throw new Error(`[TestDBGuard] Aborting test writes: connected database "${database}" appears to be production.`);
  }

  if (options.requireNonBypassRls && (rolbypassrls || rolsuper)) {
    throw new Error(
      `[TestDBGuard] RLS test requires a NOBYPASSRLS non-superuser role, but connected as "${role}" (rolbypassrls=${rolbypassrls}, rolsuper=${rolsuper}).`,
    );
  }

  return { database, role, rolbypassrls, rolsuper };
}
