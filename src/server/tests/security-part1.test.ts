import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getAuthSecret,
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  signTotpChallengeToken,
  verifyTotpChallengeToken,
  encryptSensitiveValue,
  decryptSensitiveValue,
  hashBackupCode,
} from "../auth/crypto";
import { authService, AuthError } from "../auth/auth.service";
import { authenticateBearerToken } from "../auth/bearer";
import { institutionService, InstitutionAccessError } from "../institution/institution.service";
import { contractService, ContractSecurityError } from "../contract/contract.service";
import { SESSION_COOKIE_NAME, SESSION_STORAGE_KEY, sortRoleRows } from "../../lib/auth.shared";
import { resolveChangeRequestScope, resolveInvoiceListScope } from "../../lib/governance.functions";
import { mapPaymentDecisionToStatus } from "../../lib/payment.functions";
import { countFailedLoginAttemptsSafe } from "../../lib/rate-limit.functions";
import { countRecentInboundSafe } from "../../lib/inbound.functions";
import { generateTotpForStep, base32Decode, verifyTotpOrBackupCode } from "../../lib/totp.functions";
import { requirePlatformAdmin } from "../../lib/contracts.server";
import { assertSameOriginRequest } from "../../integrations/supabase/auth-middleware";
import { ALLOWED_STORAGE_BUCKETS, assertStorageBucketAccess } from "../../lib/storage.functions";
import { assertActivityLogPinConfigured } from "../../lib/activity-log.functions";
import { isDemoModeAllowed } from "../../lib/demo.functions";
import { invoiceStatusEnum, paymentStatusEnum } from "../../../drizzle/schema";
import { resolveVerifiedTestDatabaseUrl, verifyTestBranchBeforeWrite } from "./test-db-guard";

/**
 * Lightweight stateful mock DbClient for deterministic Part 1 security tests
 * verifying credential authentication, JWT rejection, DB role/tenant authority,
 * password change/reset flows, and cross-institution isolation.
 */
function createSecurityTestDb(seed?: {
  profiles?: Array<Record<string, any>>;
  user_roles?: Array<Record<string, any>>;
  user_sessions?: Array<Record<string, any>>;
  institutions?: Array<Record<string, any>>;
  official_contracts?: Array<Record<string, any>>;
  audit_logs?: Array<Record<string, any>>;
}) {
  const store: Record<string, Array<Record<string, any>>> = {
    profiles: seed?.profiles ? [...seed.profiles] : [],
    user_roles: seed?.user_roles ? [...seed.user_roles] : [],
    user_sessions: seed?.user_sessions ? [...seed.user_sessions] : [],
    institutions: seed?.institutions ? [...seed.institutions] : [],
    official_contracts: seed?.official_contracts ? [...seed.official_contracts] : [],
    audit_logs: seed?.audit_logs ? [...seed.audit_logs] : [],
  };

  function makeChain(table: string) {
    const filters: Array<(row: Record<string, any>) => boolean> = [];
    let pendingUpdate: Record<string, any> | null = null;
    let pendingInsert: Array<Record<string, any>> | null = null;
    let pendingDelete = false;

    const applyFilters = () =>
      (store[table] ?? []).filter((row) => filters.every((fn) => fn(row)));

    const execute = async (): Promise<any> => {
      if (pendingDelete) {
        const current = store[table] ?? [];
        const removed: Array<Record<string, any>> = [];
        store[table] = current.filter((row) => {
          const matches = filters.every((fn) => fn(row));
          if (matches) removed.push(row);
          return !matches;
        });
        return { data: removed, error: null, count: removed.length };
      }
      if (pendingInsert) {
        store[table] = store[table] ?? [];
        store[table].push(...pendingInsert);
        return { data: pendingInsert[0], error: null };
      }
      if (pendingUpdate) {
        const matched = applyFilters();
        for (const r of matched) {
          Object.assign(r, pendingUpdate);
        }
        return { data: matched[0] ?? null, error: null };
      }
      const rows = applyFilters();
      return { data: rows, error: null, count: rows.length };
    };

    const chain: any = {
      select: () => chain,
      insert: (payload: any) => {
        pendingInsert = Array.isArray(payload) ? payload : [payload];
        return chain;
      },
      update: (payload: any) => {
        pendingUpdate = payload;
        return chain;
      },
      delete: () => {
        pendingDelete = true;
        return chain;
      },
      upsert: (payload: any) => {
        pendingInsert = Array.isArray(payload) ? payload : [payload];
        return chain;
      },
      eq: (col: string, val: any) => {
        filters.push((r) => r[col] === val);
        return chain;
      },
      neq: (col: string, val: any) => {
        filters.push((r) => r[col] !== val);
        return chain;
      },
      in: (col: string, vals: any[]) => {
        filters.push((r) => vals.includes(r[col]));
        return chain;
      },
      gte: (col: string, val: any) => {
        filters.push((r) => r[col] >= val);
        return chain;
      },
      ilike: (col: string, val: string) => {
        filters.push((r) => String(r[col] ?? "").toLowerCase() === String(val).toLowerCase());
        return chain;
      },
      maybeSingle: async () => {
        const res = await execute();
        const row = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
        return { data: row, error: null };
      },
      single: async () => {
        const res = await execute();
        const row = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
        return { data: row, error: row ? null : { message: "Not found" } };
      },
      then: (resolveFn: any, rejectFn: any) => execute().then(resolveFn, rejectFn),
    };

    return chain;
  }

  return {
    store,
    from: (table: string) => makeChain(table),
  } as any;
}

describe("Part 1 Security & Auth Hardening Suite", () => {
  const TEST_SECRET = "part1-strong-auth-secret-key-for-security-suite";

  describe("1. Env Secret Enforcement & Unified Session Constants", () => {
    it("unifies cookie and storage key onto sdz_session_token", () => {
      expect(SESSION_COOKIE_NAME).toBe("sdz_session_token");
      expect(SESSION_STORAGE_KEY).toBe("sdz_session_token");
    });

    it("throws explicitly when AUTH_SECRET / JWT_SECRET are missing or shorter than 32 chars", () => {
      const prevAuth = process.env.AUTH_SECRET;
      const prevJwt = process.env.JWT_SECRET;
      try {
        delete process.env.AUTH_SECRET;
        delete process.env.JWT_SECRET;
        expect(() => getAuthSecret()).toThrow(/AUTH_SECRET/);

        process.env.AUTH_SECRET = "a".repeat(31);
        expect(() => getAuthSecret()).toThrow(/32/);

        process.env.AUTH_SECRET = "a".repeat(32);
        expect(getAuthSecret()).toBe("a".repeat(32));
      } finally {
        if (prevAuth !== undefined) process.env.AUTH_SECRET = prevAuth;
        else delete process.env.AUTH_SECRET;
        if (prevJwt !== undefined) process.env.JWT_SECRET = prevJwt;
        else delete process.env.JWT_SECRET;
      }
    });
  });

  describe("2. Real Password Verification, Registration, Change & Reset", () => {
    it("allows login with valid password and rejects wrong password or missing password_hash", async () => {
      const userId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const instId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      const validHash = hashPassword("CorrectPass!2026");

      const db = createSecurityTestDb({
        institutions: [{ id: instId, name: "مدرسة النجاح", status: "active" }],
        profiles: [
          {
            id: userId,
            email: "director@najah.dz",
            first_name: "أحمد",
            last_name: "بن علي",
            institution_id: instId,
            password_hash: validHash,
          },
          {
            id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            email: "nohash@najah.dz",
            first_name: "بدون",
            last_name: "تشفير",
            institution_id: instId,
            password_hash: null,
          },
        ],
        user_roles: [
          { user_id: userId, role: "institution_admin", institution_id: instId },
        ],
      });

      const svc = authService(db, TEST_SECRET);

      // Valid password succeeds and returns signed JWT
      const ok = await svc.authenticateUser("director@najah.dz", "CorrectPass!2026");
      expect(ok.token).toBeTruthy();
      expect(ok.token!.split(".").length).toBe(3);
      expect(ok.user.roles).toEqual(["institution_admin"]);
      expect(ok.user.institutionId).toBe(instId);

      // Wrong password must reject before issuing session and record audit log
      await expect(svc.authenticateUser("director@najah.dz", "WrongPass!2026")).rejects.toThrow(AuthError);
      expect(db.store.audit_logs.some((l: Record<string, any>) => l.action === "login_failed")).toBe(true);

      // Profile without password_hash must NOT authenticate
      await expect(svc.authenticateUser("nohash@najah.dz", "anything")).rejects.toThrow(AuthError);
    });

    it("supports password change (verifying old password) and admin password reset", async () => {
      const userId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
      const instId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
      const db = createSecurityTestDb({
        institutions: [{ id: instId, name: "مدرسة الأمل", status: "active" }],
        profiles: [
          {
            id: userId,
            email: "teacher@amal.dz",
            first_name: "سعيد",
            last_name: "مراد",
            institution_id: instId,
            password_hash: hashPassword("OldPass#123"),
          },
        ],
        user_roles: [{ user_id: userId, role: "teacher", institution_id: instId }],
      });

      const svc = authService(db, TEST_SECRET);

      // Rejects change when current password is wrong
      await expect(svc.changePassword(userId, "BadOldPass", "NewPass#456")).rejects.toThrow(AuthError);

      // Succeeds when current password matches
      await svc.changePassword(userId, "OldPass#123", "NewPass#456");
      await expect(svc.authenticateUser("teacher@amal.dz", "OldPass#123")).rejects.toThrow(AuthError);
      const afterChange = await svc.authenticateUser("teacher@amal.dz", "NewPass#456");
      expect(afterChange.token).toBeTruthy();

      // Admin reset updates password_hash cleanly and logs audit event with actorId
      const adminId = "f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0";
      await svc.setPasswordByAdmin(userId, "ResetPass#789", adminId);
      const afterReset = await svc.authenticateUser("teacher@amal.dz", "ResetPass#789");
      expect(afterReset.user.id).toBe(userId);
      expect(
        db.store.audit_logs.some(
          (l: Record<string, any>) => l.action === "password_reset_resolved" && l.actor_id === adminId,
        ),
      ).toBe(true);
    });
  });

  describe("3. Strict JWT Verification & DB-Backed Role Authority", () => {
    it("rejects unsigned alg:none, invalid signature, and expired JWT tokens", async () => {
      const db = createSecurityTestDb();

      // Unsigned alg=none token forged by attacker
      const unsignedHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const forgedPayload = Buffer.from(
        JSON.stringify({
          sub: "11111111-1111-1111-1111-111111111111",
          email: "attacker@evil.dz",
          role: "platform_admin",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url");
      const algNoneToken = `${unsignedHeader}.${forgedPayload}.`;

      await expect(authenticateBearerToken(algNoneToken, db, TEST_SECRET)).rejects.toThrow();

      // Validly structured token signed with wrong secret
      const wrongSecretToken = signSessionToken(
        { userId: "11111111-1111-1111-1111-111111111111", email: "a@b.dz", role: "platform_admin" },
        "wrong-attacker-secret-123456",
        3600,
      );
      await expect(authenticateBearerToken(wrongSecretToken, db, TEST_SECRET)).rejects.toThrow();

      // Expired token signed with real secret
      const expiredToken = signSessionToken(
        { userId: "11111111-1111-1111-1111-111111111111", email: "a@b.dz", role: "student" },
        TEST_SECRET,
        -60,
      );
      await expect(authenticateBearerToken(expiredToken, db, TEST_SECRET)).rejects.toThrow();
      expect(verifySessionToken(expiredToken, TEST_SECRET).reason).toBe("token_expired");
    });

    it("ignores tampered role/institutionId inside token and enforces authoritative DB records", async () => {
      const studentId = "99999999-9999-9999-9999-999999999999";
      const realInstId = "12121212-1212-1212-1212-121212121212";
      const targetOtherInstId = "34343434-3434-3434-3434-343434343434";

      const db = createSecurityTestDb({
        profiles: [
          { id: studentId, email: "student@school.dz", institution_id: realInstId },
        ],
        user_roles: [
          { user_id: studentId, role: "student", institution_id: realInstId },
        ],
        institutions: [
          { id: realInstId, name: "مدرسة أ" },
          { id: targetOtherInstId, name: "مدرسة ب" },
        ],
        official_contracts: [
          { id: "c-other", institution_id: targetOtherInstId, number: "SDZ-B" },
        ],
      });

      // Even if a token somehow claimed platform_admin + other institutionId, middleware resolves from DB!
      const tokenWithEscalatedClaims = signSessionToken(
        {
          userId: studentId,
          email: "student@school.dz",
          role: "platform_admin",
          institutionId: targetOtherInstId,
        },
        TEST_SECRET,
        3600,
      );

      const authCtx = await authenticateBearerToken(tokenWithEscalatedClaims, db, TEST_SECRET);
      expect(authCtx.userId).toBe(studentId);
      expect(authCtx.claims.role).toBe("student");
      expect(authCtx.claims.roles).toEqual(["student"]);
      expect(authCtx.claims.institution_id).toBe(realInstId);

      // Using those authoritative claims, accessing platform list, other institution, or other contract fails
      const instSvc = institutionService(db);
      await expect(instSvc.listInstitutionsForPlatformAdmin({ role: authCtx.claims.role! })).rejects.toThrow(
        InstitutionAccessError,
      );
      await expect(
        instSvc.getInstitutionDetails(targetOtherInstId, {
          id: authCtx.userId,
          role: authCtx.claims.role!,
          institutionId: authCtx.claims.institution_id,
        }),
      ).rejects.toThrow(InstitutionAccessError);

      const contractSvc = contractService(db);
      await expect(
        contractSvc.getContract("c-other", {
          id: authCtx.userId,
          role: authCtx.claims.role!,
          institutionId: authCtx.claims.institution_id,
        }),
      ).rejects.toThrow(ContractSecurityError);
    });

    it("resolves primary role deterministically by privilege hierarchy across multi-role accounts", async () => {
      const multiUserId = "77777777-7777-7777-7777-777777777777";
      const instId = "88888888-8888-8888-8888-888888888888";

      expect(
        sortRoleRows([
          { role: "student" },
          { role: "teacher" },
          { role: "institution_admin" },
        ]).map((r) => r.role),
      ).toEqual(["institution_admin", "teacher", "student"]);

      const db = createSecurityTestDb({
        profiles: [{ id: multiUserId, email: "director@dual.dz", institution_id: instId }],
        // Student row intentionally placed before institution_admin row
        user_roles: [
          { user_id: multiUserId, role: "student", institution_id: instId },
          { user_id: multiUserId, role: "institution_admin", institution_id: instId },
        ],
      });

      const token = signSessionToken(
        { userId: multiUserId, email: "director@dual.dz", role: "student", institutionId: instId },
        TEST_SECRET,
        3600,
      );
      const authCtx = await authenticateBearerToken(token, db, TEST_SECRET);
      expect(authCtx.claims.role).toBe("institution_admin");
      expect(authCtx.claims.roles).toEqual(["institution_admin", "student"]);
    });

    it("enforces tenant isolation on invoice listing and change requests", () => {
      const instA = "11111111-1111-1111-1111-111111111111";
      const instB = "22222222-2222-2222-2222-222222222222";

      // Students and teachers cannot list institution invoices
      expect(() =>
        resolveInvoiceListScope({ roles: ["student"], institution_id: instA }),
      ).toThrow();
      expect(() =>
        resolveInvoiceListScope({ roles: ["teacher"], institution_id: instA }),
      ).toThrow();

      // Institution admin can only list their own institution's invoices
      expect(
        resolveInvoiceListScope({ roles: ["institution_admin"], institution_id: instA }),
      ).toEqual({ isPlatform: false, institutionId: instA });
      expect(() =>
        resolveInvoiceListScope({ roles: ["institution_admin"], institution_id: instA }, instB),
      ).toThrow();

      // Change request targeting foreign institution is blocked
      expect(() =>
        resolveChangeRequestScope(
          { roles: ["student"], institution_id: instA },
          "institution",
          instB,
        ),
      ).toThrow();
      expect(() =>
        resolveChangeRequestScope(
          { roles: ["institution_admin"], institution_id: instA },
          "institution_settings",
          instB,
        ),
      ).toThrow();
      expect(
        resolveChangeRequestScope(
          { roles: ["institution_admin"], institution_id: instA },
          "institution",
          undefined,
        ),
      ).toBe(instA);
    });
  });

  describe("4. Neon PostgreSQL SQL Migrations Review & Role/RLS Readiness", () => {
    it("verifies reversible password_hash migrations and zero literal passwords / NOBYPASSRLS in SQL", () => {
      const m008 = readFileSync(resolve(process.cwd(), "migrations/0008_neon_roles_and_privileges.sql"), "utf8");
      const m009 = readFileSync(resolve(process.cwd(), "migrations/0009_row_level_security_and_tenant_isolation.sql"), "utf8");
      const m010 = readFileSync(resolve(process.cwd(), "migrations/0010_profiles_password_hash.sql"), "utf8");
      const d014 = readFileSync(resolve(process.cwd(), "drizzle/legacy-migrations/0014_profiles_password_hash.sql"), "utf8");

      // Roles: strict NOBYPASSRLS and zero hardcoded placeholder passwords
      expect(m008).toContain("NOBYPASSRLS");
      expect(m008).not.toContain("replace_with_neon_app_password_at_runtime");
      expect(m008).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contract_artifacts FROM sdz_app_user");
      expect(m008).toContain("REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM sdz_app_user");

      // Complete RLS policy coverage across previously unpolicied tables
      for (const policyName of [
        "programs_tenant_isolation",
        "specializations_tenant_isolation",
        "subjects_tenant_isolation",
        "exams_tenant_isolation",
        "questions_tenant_isolation",
        "options_tenant_isolation",
        "schedules_tenant_isolation",
        "rooms_tenant_isolation",
        "announcements_tenant_isolation",
        "enrollments_tenant_isolation",
        "attendance_tenant_isolation",
        "homework_submissions_isolation",
        "payments_tenant_isolation",
        "password_reset_requests_isolation",
        "files_tenant_isolation",
        "lesson_completions_isolation",
        "auth_lookup_by_email",
      ]) {
        expect(m009).toContain(policyName);
      }

      // Reversible UP/DOWN sections in password_hash migrations and ordering safety in 0009
      expect(m009).toContain("ADD COLUMN IF NOT EXISTS password_hash text");
      expect(m009.indexOf("ADD COLUMN IF NOT EXISTS password_hash text")).toBeLessThan(
        m009.indexOf("CREATE OR REPLACE FUNCTION public.auth_lookup_by_email"),
      );
      expect(m009).toContain("payments_update_platform");
      expect(m009).toContain("payments_delete_platform");
      expect(m009).toContain("trial_requests_read_platform");
      expect(m009).toContain("support_messages_read_platform");
      expect(m009).toContain("login_attempts_read_platform");
      expect(m010).toContain("ADD COLUMN IF NOT EXISTS password_hash text");
      expect(m010).toContain("DROP COLUMN IF EXISTS password_hash");
      expect(d014).toContain("ADD COLUMN IF NOT EXISTS password_hash text");
      expect(d014).toContain("DROP COLUMN IF EXISTS password_hash");
    });

    it("verifies zero hardcoded auth or storage secrets remain in server/auth, auth-middleware, demo, and storage files", () => {
      const files = [
        "src/server/auth/crypto.ts",
        "src/server/auth/auth.service.ts",
        "src/integrations/supabase/auth-middleware.ts",
        "src/lib/demo.functions.ts",
        "src/server/storage/storage.adapter.ts",
      ];
      for (const rel of files) {
        const content = readFileSync(resolve(process.cwd(), rel), "utf8");
        expect(content).not.toContain("study-dz-independent-auth-secret-key-2026");
        expect(content).not.toContain("studydz-storage-signing-secret");
      }
      const authMiddleware = readFileSync(resolve(process.cwd(), "src/integrations/supabase/auth-middleware.ts"), "utf8");
      expect(authMiddleware).not.toContain("JSON.parse(Buffer.from(parts[1]");
    });

    it("verifies withRlsUserContext runs inside drizzleDb.transaction without dispatching to unpinned pool", () => {
      const adapterSrc = readFileSync(resolve(process.cwd(), "src/server/db/adapter.ts"), "utf8");
      const start = adapterSrc.indexOf("export async function withRlsUserContext");
      const end = adapterSrc.indexOf("export async function withRlsDbClient");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);

      const fnBody = adapterSrc.slice(start, end);
      expect(fnBody).toContain("drizzleDb.transaction");
      expect(fnBody).toContain("set_config('app.current_user_id'");
      expect(fnBody).not.toContain("fn(db as any)");

      const authMiddlewareSrc = readFileSync(
        resolve(process.cwd(), "src/integrations/supabase/auth-middleware.ts"),
        "utf8",
      );
      expect(authMiddlewareSrc).toContain("withRlsDbClient");
      expect(adapterSrc).toContain("rlsDbStorage.run");
    });

    it("enforces contiguous 0001-0011 /migrations track, zero Supabase roles, column grants, and archived drizzle/legacy-migrations", () => {
      const migrationsDir = resolve(process.cwd(), "migrations");
      const sqlFiles = readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

      expect(sqlFiles.length).toBe(11);
      const prefixes = sqlFiles.map((f) => {
        const m = /^(\d{4})_/.exec(f);
        expect(m).not.toBeNull();
        return Number(m![1]);
      });

      // Strictly contiguous 1..11 with zero duplicates and zero gaps
      expect(prefixes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

      const m008 = readFileSync(resolve(migrationsDir, "0008_neon_roles_and_privileges.sql"), "utf8");
      expect(m008).toContain("REVOKE SELECT, INSERT, UPDATE ON public.profiles FROM sdz_app_user");

      const m011 = readFileSync(resolve(migrationsDir, "0011_security_rls_and_schema_hardening.sql"), "utf8");
      expect(m011).toContain("CREATE TYPE public.invoice_status AS ENUM");
      expect(m011).toContain("e.institution_id = questions.institution_id");
      expect(m011).toContain("e.institution_id = options.institution_id");
      expect(m011).toContain("a.institution_id = results.institution_id");
      expect(m011).toContain("a.institution_id = homework_submissions.institution_id");
      expect(m011).toContain("ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password_hash text");
      expect(m011).toContain("public.auth_lookup_by_email");
      expect(m011).toContain("REVOKE ALL ON FUNCTION public.auth_lookup_by_email(text) FROM PUBLIC");
      expect(m011).toContain("public.auth_lookup_by_id");
      expect(m011).toContain("public.auth_get_totp_record");

      // Zero Supabase role mentions in /migrations/*.sql
      for (const file of sqlFiles) {
        const sql = readFileSync(resolve(migrationsDir, file), "utf8");
        const sqlWithoutComments = sql.replace(/--.*$/gm, "");
        expect(sql).not.toMatch(/\b(anon|service_role)\b/i);
        expect(sqlWithoutComments).not.toMatch(/\b(TO|FROM|ROLE|GRANT|REVOKE)\s+authenticated\b/i);
        expect(sqlWithoutComments).not.toMatch(/'authenticated'/i);
      }

      // Legacy drizzle/migrations moved to drizzle/legacy-migrations with historical README
      expect(existsSync(resolve(process.cwd(), "drizzle/migrations"))).toBe(false);
      const legacyReadme = readFileSync(
        resolve(process.cwd(), "drizzle/legacy-migrations/README.md"),
        "utf8",
      );
      expect(legacyReadme).toContain("تاريخي، لا يُشغَّل");

      // drizzle.config.ts and package.json must not run drizzle-kit push/migrate on old path
      const drizzleCfg = readFileSync(resolve(process.cwd(), "drizzle.config.ts"), "utf8");
      expect(drizzleCfg).not.toContain("./drizzle/migrations");
      const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
      for (const scriptVal of Object.values(pkg.scripts ?? {}) as string[]) {
        expect(scriptVal).not.toMatch(/^(?:npx\s+)?drizzle-kit\s+(migrate|push)/);
      }
      expect(pkg.scripts["db:migrate"]).toContain("exit 1");
      expect(pkg.scripts["db:push"]).toContain("exit 1");
    });

    const verifiedTestUrl = resolveVerifiedTestDatabaseUrl();
    it.skipIf(!verifiedTestUrl)(
      "live RLS test on TEST_DATABASE_URL as NOBYPASSRLS sdz_app_user isolates Inst A from Inst B",
      async () => {
        const { default: postgres } = await import("postgres");
        const sql = postgres(verifiedTestUrl!, { prepare: false });
        try {
          const info = await verifyTestBranchBeforeWrite(sql as any, { requireNonBypassRls: true });
          expect(info.rolbypassrls).toBe(false);
          const rows = await sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'sdz_app_user'`;
          expect(rows[0]?.rolbypassrls).toBe(false);
        } finally {
          await sql.end();
        }
      },
    );
  });

  describe("5. Payment Status Enum Alignment & Strict RPC-Only Fail-Closed Rate Limits", () => {
    it("maps approved payment decisions strictly to enum value 'verified' without altering payment_status enum", () => {
      expect(paymentStatusEnum.enumValues).toEqual(["pending", "verified", "rejected"]);
      expect(mapPaymentDecisionToStatus("verified")).toBe("verified");
      expect(mapPaymentDecisionToStatus("accepted")).toBe("verified");
      expect(mapPaymentDecisionToStatus("rejected")).toBe("rejected");
      expect(mapPaymentDecisionToStatus("needs_modification")).toBe("pending");

      const paymentSrc = readFileSync(resolve(process.cwd(), "src/lib/payment.functions.ts"), "utf8");
      expect(paymentSrc).not.toContain('status: "accepted"');
      expect(paymentSrc).toContain("mapPaymentDecisionToStatus");
    });

    it("uses count_recent_* RPCs exclusively and fails closed even on 42883 without calling db.from", async () => {
      const since = new Date().toISOString();

      // 1. Primary RPC success
      const okRpcDb = {
        rpc: async (fn: string) => ({ data: fn === "count_recent_failed_logins" ? 5 : 3, error: null }),
      };
      await expect(countFailedLoginAttemptsSafe(okRpcDb, "user@dz.com", since)).resolves.toBe(5);
      await expect(
        countRecentInboundSafe(okRpcDb, "count_recent_trial_requests", "user@dz.com", since),
      ).resolves.toBe(3);

      // 2. Both 42501 and 42883 RPC failures MUST reject loudly and NEVER fall back to db.from() or 0
      for (const errObj of [
        { code: "42501", message: "permission denied" },
        { code: "42883", message: "function count_recent_* does not exist" },
      ]) {
        let fallbackCalled = false;
        const errRpcDb = {
          rpc: async () => ({ data: null, error: errObj }),
          from: () => {
            fallbackCalled = true;
            throw new Error("Fallback direct table access must not exist");
          },
        };
        await expect(countFailedLoginAttemptsSafe(errRpcDb, "user@dz.com", since)).rejects.toThrow();
        expect(fallbackCalled).toBe(false);
        await expect(
          countRecentInboundSafe(errRpcDb, "count_recent_support_messages", "user@dz.com", since),
        ).rejects.toThrow();
        expect(fallbackCalled).toBe(false);
      }
    });
  });

  describe("6. Launch Readiness Critical Security Hardening", () => {
    it("enforces 2FA challenge step before issuing session JWT and rejects pending tokens on bearer routes", async () => {
      const adminId = "aaaaaaaa-1111-2222-3333-444444444444";
      const instId = "bbbbbbbb-1111-2222-3333-444444444444";
      const rawTotpSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
      const encryptedTotpSecret = encryptSensitiveValue(rawTotpSecret, TEST_SECRET);
      expect(encryptedTotpSecret.startsWith("enc:v1:")).toBe(true);
      expect(decryptSensitiveValue(encryptedTotpSecret, TEST_SECRET)).toBe(rawTotpSecret);

      const backupPlain = "a1b2c3d4";
      const backupHashed = hashBackupCode(backupPlain, TEST_SECRET);

      const db = createSecurityTestDb({
        institutions: [{ id: instId, name: "مؤسسة الأمان", status: "active" }],
        profiles: [
          {
            id: adminId,
            email: "admin2fa@aman.dz",
            first_name: "كريم",
            last_name: "بوزيد",
            institution_id: instId,
            password_hash: hashPassword("AdminPass#2026"),
            totp_enabled: true,
            totp_secret: encryptedTotpSecret,
            totp_backup_codes: [backupHashed],
          },
        ],
        user_roles: [{ user_id: adminId, role: "institution_admin", institution_id: instId }],
      });

      const svc = authService(db, TEST_SECRET);

      // Step 1: password auth must return requiresTotp + challengeToken, and NO full session token
      const loginStep1 = await svc.authenticateUser("admin2fa@aman.dz", "AdminPass#2026");
      expect(loginStep1.requiresTotp).toBe(true);
      expect(loginStep1.token).toBeNull();
      expect(loginStep1.challengeToken).toBeTruthy();

      // Challenge token MUST be rejected by verifySessionToken and authenticateBearerToken
      const challengeToken = loginStep1.challengeToken!;
      expect(verifySessionToken(challengeToken, TEST_SECRET).valid).toBe(false);
      await expect(authenticateBearerToken(challengeToken, db, TEST_SECRET)).rejects.toThrow(/Invalid or expired/);
      expect(verifyTotpChallengeToken(challengeToken, TEST_SECRET).valid).toBe(true);

      // Step 2a: valid TOTP code verifies cleanly
      const currentCode = await generateTotpForStep(base32Decode(rawTotpSecret), Math.floor(Date.now() / 1000 / 30));
      const totpCheck = await verifyTotpOrBackupCode(db, adminId, currentCode, TEST_SECRET);
      expect(totpCheck).toEqual({ required: true, verified: true });

      // Step 2b: single-use backup code verifies once and cannot be reused
      const backupFirst = await verifyTotpOrBackupCode(db, adminId, backupPlain, TEST_SECRET);
      expect(backupFirst).toEqual({ required: true, verified: true });
      const backupReuse = await verifyTotpOrBackupCode(db, adminId, backupPlain, TEST_SECRET);
      expect(backupReuse).toEqual({ required: true, verified: false });

      // Step 3: issuing real session after TOTP works with bearer auth
      const fullSession = await svc.issueSessionAfterTotp(adminId);
      expect(fullSession.token.split(".").length).toBe(3);
      const bearerCtx = await authenticateBearerToken(fullSession.token, db, TEST_SECRET);
      expect(bearerCtx.claims.role).toBe("institution_admin");

      // Legacy plain token helper sanity check
      const explicitPending = signTotpChallengeToken({ userId: adminId, email: "admin2fa@aman.dz" }, TEST_SECRET);
      expect(verifySessionToken(explicitPending, TEST_SECRET).reason).toBe("invalid_scope");
    });

    it("prevents third-party TOTP QR leak, raw /health error leaks, legacy contract bypass, and unprotected support inserts", () => {
      const totpSettingsSrc = readFileSync(resolve(process.cwd(), "src/components/dashboard/TotpSettings.tsx"), "utf8");
      expect(totpSettingsSrc).not.toContain("api.qrserver.com");

      const healthSrc = readFileSync(resolve(process.cwd(), "src/routes/health.tsx"), "utf8");
      expect(healthSrc).not.toContain("error: error.message");
      expect(healthSrc).not.toContain("error: err");
      expect(healthSrc).toContain('{ status: "degraded", database: "error" }');
      expect(healthSrc).toContain('{ status: "error", database: "unreachable" }');

      const legacyContractsSrc = readFileSync(resolve(process.cwd(), "src/lib/contracts.functions.ts"), "utf8");
      expect(legacyContractsSrc).toContain("LEGACY_WORKFLOW_DISABLED_ERROR");
      expect(legacyContractsSrc).not.toContain('.update({ status: "active"');

      const platformSrc = readFileSync(resolve(process.cwd(), "src/lib/platform.functions.ts"), "utf8");
      expect(platformSrc).toContain("count_recent_support_messages");
    });
  });

  describe("7. Session Revocation, Mandatory Platform 2FA, CSRF, Storage & Enum Hardening", () => {
    it("persists sessions in user_sessions, revokes on logout, and invalidates all sessions on password change", async () => {
      const userId = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1";
      const instId = "b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1";
      const db = createSecurityTestDb({
        institutions: [{ id: instId, name: "مؤسسة الجلسات", status: "active" }],
        profiles: [
          {
            id: userId,
            email: "session@instidz.dz",
            first_name: "عمر",
            last_name: "سالم",
            institution_id: instId,
            password_hash: hashPassword("SessionPass#123"),
            totp_enabled: false,
          },
        ],
        user_roles: [{ user_id: userId, role: "institution_admin", institution_id: instId }],
      });

      const svc = authService(db, TEST_SECRET);
      const login1 = await svc.authenticateUser("session@instidz.dz", "SessionPass#123");
      expect(login1.token).toBeTruthy();
      expect(db.store.user_sessions.length).toBe(1);

      // Active session succeeds with requireSessionRecord: true
      const ctx1 = await authenticateBearerToken(login1.token!, db, TEST_SECRET, {
        requireSessionRecord: true,
      });
      expect(ctx1.sessionId).toBeTruthy();

      // Revoking specific session invalidates bearer auth immediately
      await svc.revokeSession(ctx1.sessionId!, userId);
      expect(db.store.user_sessions.length).toBe(0);
      await expect(
        authenticateBearerToken(login1.token!, db, TEST_SECRET, { requireSessionRecord: true }),
      ).rejects.toThrow(/revoked or expired/i);

      // Password change revokes all active sessions for that user
      const login2 = await svc.authenticateUser("session@instidz.dz", "SessionPass#123");
      expect(db.store.user_sessions.length).toBe(1);
      await svc.changePassword(userId, "SessionPass#123", "SessionPass#456");
      expect(db.store.user_sessions.length).toBe(0);
      await expect(
        authenticateBearerToken(login2.token!, db, TEST_SECRET, { requireSessionRecord: true }),
      ).rejects.toThrow(/revoked or expired/i);
    });

    it("enforces mandatory 2FA for platform_admin administrative actions", async () => {
      const adminNo2fa = "c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1";
      const adminWith2fa = "d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1";
      const db = createSecurityTestDb({
        profiles: [
          { id: adminNo2fa, email: "no2fa@instidz.dz", totp_enabled: false },
          { id: adminWith2fa, email: "with2fa@instidz.dz", totp_enabled: true },
        ],
        user_roles: [
          { id: "r1", user_id: adminNo2fa, role: "platform_admin" },
          { id: "r2", user_id: adminWith2fa, role: "platform_admin" },
        ],
      });

      await expect(
        requirePlatformAdmin({ userId: adminNo2fa, supabase: db }),
      ).rejects.toThrow(/2FA/);

      await expect(
        requirePlatformAdmin({ userId: adminWith2fa, supabase: db }),
      ).resolves.toBeUndefined();
    });

    it("enforces Same-Origin CSRF checks and blocks cross-site/origin-mismatch requests", () => {
      const sameOriginReq = new Request("https://instidz.dz/api/test", {
        method: "POST",
        headers: {
          host: "instidz.dz",
          origin: "https://instidz.dz",
          "sec-fetch-site": "same-origin",
        },
      });
      expect(() => assertSameOriginRequest(sameOriginReq)).not.toThrow();

      const crossSiteReq = new Request("https://instidz.dz/api/test", {
        method: "POST",
        headers: {
          host: "instidz.dz",
          origin: "https://instidz.dz",
          "sec-fetch-site": "cross-site",
        },
      });
      expect(() => assertSameOriginRequest(crossSiteReq)).toThrow(/Cross-site/i);

      const mismatchReq = new Request("https://instidz.dz/api/test", {
        method: "POST",
        headers: {
          host: "instidz.dz",
          origin: "https://evil.example",
          "sec-fetch-site": "same-site",
        },
      });
      expect(() => assertSameOriginRequest(mismatchReq)).toThrow(/Origin mismatch/i);
    });

    it("restricts storage buckets via allowlist and role policies", () => {
      expect(Array.from(ALLOWED_STORAGE_BUCKETS).sort()).toEqual([
        "homework-submissions",
        "institution-media",
        "lesson-materials",
        "payment-proofs",
      ]);

      expect(() =>
        assertStorageBucketAccess(
          "unknown-bucket",
          "upload",
          { roles: ["institution_admin"], institution_id: "inst-a" },
          "inst-a/file.png",
        ),
      ).toThrow(/غير مسموحة/);

      expect(() =>
        assertStorageBucketAccess(
          "payment-proofs",
          "read",
          { roles: ["student"], institution_id: "inst-a" },
          "inst-a/receipt.png",
        ),
      ).toThrow(/مدير المؤسسة/);

      expect(() =>
        assertStorageBucketAccess(
          "lesson-materials",
          "upload",
          { roles: ["student"], institution_id: "inst-a" },
          "inst-a/lesson.pdf",
        ),
      ).toThrow(/للأساتذة/);

      expect(() =>
        assertStorageBucketAccess(
          "lesson-materials",
          "upload",
          { roles: ["teacher"], institution_id: "inst-a" },
          "inst-a/lesson.pdf",
        ),
      ).not.toThrow();
    });

    it("requires ACTIVITY_LOG_PIN, fails closed in prod for demo mode, and defines dedicated invoice_status enum", () => {
      const prevPin = process.env.ACTIVITY_LOG_PIN;
      const prevNodeEnv = process.env.NODE_ENV;
      const prevDemo = process.env.ENABLE_DEMO_MODE;
      try {
        delete process.env.ACTIVITY_LOG_PIN;
        expect(() => assertActivityLogPinConfigured()).toThrow(/ACTIVITY_LOG_PIN/);
        process.env.ACTIVITY_LOG_PIN = "987654";
        expect(assertActivityLogPinConfigured()).toBe("987654");

        process.env.NODE_ENV = "production";
        process.env.ENABLE_DEMO_MODE = "true";
        expect(isDemoModeAllowed()).toBe(false);
      } finally {
        if (prevPin !== undefined) process.env.ACTIVITY_LOG_PIN = prevPin;
        else delete process.env.ACTIVITY_LOG_PIN;
        if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
        else delete process.env.NODE_ENV;
        if (prevDemo !== undefined) process.env.ENABLE_DEMO_MODE = prevDemo;
        else delete process.env.ENABLE_DEMO_MODE;
      }

      expect(invoiceStatusEnum.enumValues).toEqual(["pending", "issued", "paid", "void"]);
    });
  });
});
