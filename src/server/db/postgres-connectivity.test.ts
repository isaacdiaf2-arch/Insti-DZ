import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  getServiceDb,
  verifyDatabaseConnection,
  withDbTransaction,
} from "./adapter";
import { closeDrizzleDb } from "./drizzle";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { supportMessages } from "../../../drizzle/schema";
import {
  isSameDatabaseTarget,
  resolveVerifiedTestDatabaseUrl,
  verifyTestBranchBeforeWrite,
} from "../tests/test-db-guard";

const LIVE_URL = resolveVerifiedTestDatabaseUrl();

describe("PostgreSQL Database Adapter — Explicit Failure & No Silent Fallback", () => {
  afterAll(async () => {
    await closeDrizzleDb();
  });

  it("throws an explicit error from getServiceDb when no PostgreSQL URL is configured", async () => {
    const origDb = process.env.DATABASE_URL;
    const origTest = process.env.TEST_DATABASE_URL;
    const origMig = process.env.LOVABLE_DB_MIGRATION_URL;
    try {
      delete process.env.DATABASE_URL;
      delete process.env.TEST_DATABASE_URL;
      delete process.env.LOVABLE_DB_MIGRATION_URL;

      await expect(getServiceDb()).rejects.toThrowError(/not configured/i);
      await expect(supabaseAdmin.from("institutions").select("id").limit(1)).rejects.toThrowError(/not configured/i);
      await expect(supabaseAdmin.rpc("has_role", { _user_id: "00000000-0000-0000-0000-000000000000", _role: "student" })).rejects.toThrowError(/not configured/i);
    } finally {
      if (origDb !== undefined) process.env.DATABASE_URL = origDb;
      if (origTest !== undefined) process.env.TEST_DATABASE_URL = origTest;
      if (origMig !== undefined) process.env.LOVABLE_DB_MIGRATION_URL = origMig;
    }
  });

  it("blocks fallback to production DATABASE_URL under Vitest and rejects matching test/prod targets", async () => {
    const origDb = process.env.DATABASE_URL;
    const origTest = process.env.TEST_DATABASE_URL;
    try {
      process.env.DATABASE_URL = "postgresql://user:pass@ep-prod-123-pooler.eu-central-1.aws.neon.tech/instidz?sslmode=require";
      delete process.env.TEST_DATABASE_URL;

      expect(resolveVerifiedTestDatabaseUrl()).toBeNull();
      await expect(getServiceDb()).rejects.toThrowError(/TEST_DATABASE_URL is not configured/i);

      // Direct vs pooler URL pointing to same Neon branch/database must be blocked
      process.env.TEST_DATABASE_URL = "postgresql://user:pass@ep-prod-123.eu-central-1.aws.neon.tech:5432/instidz?sslmode=require";
      expect(isSameDatabaseTarget(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL)).toBe(true);
      expect(() => resolveVerifiedTestDatabaseUrl()).toThrowError(/production isolation safeguard/i);

      // Distinct test branch passes target verification
      process.env.TEST_DATABASE_URL = "postgresql://user:pass@ep-test-456.eu-central-1.aws.neon.tech/instidz?sslmode=require";
      expect(resolveVerifiedTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
    } finally {
      if (origDb !== undefined) process.env.DATABASE_URL = origDb;
      else delete process.env.DATABASE_URL;
      if (origTest !== undefined) process.env.TEST_DATABASE_URL = origTest;
      else delete process.env.TEST_DATABASE_URL;
    }
  });

  it("produces an explicit PostgreSQL connection error for an unreachable database host (no memory fallback)", async () => {
    const unreachableUrl = "postgresql://invalid:invalid@127.0.0.1:59999/nonexistent?connect_timeout=1";
    await expect(verifyDatabaseConnection(unreachableUrl)).rejects.toThrow();

    const db = await getServiceDb(unreachableUrl);
    const { data, error } = await db.from("institutions").select("id").limit(1);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toBeTruthy();

    await closeDrizzleDb();
  });

  it("rejects unknown tables and columns explicitly rather than fabricating preview rows", async () => {
    const dummyUrl = LIVE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/studydz";
    const db = await getServiceDb(dummyUrl);
    expect(() => db.from("non_existent_preview_table")).toThrowError(/Unknown table/);
    const { data, error } = await db.from("institutions").select("non_existent_col").limit(1);
    expect(data).toBeNull();
    expect(error?.message).toMatch(/Unknown column/);
    await closeDrizzleDb();
  });
});

describe.skipIf(!LIVE_URL)("PostgreSQL Live CRUD & Transaction Integration (insti-dz-test only)", () => {
  afterAll(async () => {
    await closeDrizzleDb();
  });

  it("verifies connection, reads existing rows, executes controlled INSERT/SELECT/UPDATE/DELETE, and verifies transaction rollback", async () => {
    await expect(verifyDatabaseConnection(LIVE_URL!)).resolves.toEqual({ ok: true });

    const db = await getServiceDb(LIVE_URL!);
    await verifyTestBranchBeforeWrite(db.sql);

    // 1. Read existing records without modifying any customer data
    const existingRes = await db.from("institutions").select("id, name, status").limit(5);
    expect(existingRes.error).toBeNull();
    expect(Array.isArray(existingRes.data)).toBe(true);

    // 2. Controlled test insert -> read -> update -> delete (only test row)
    const testMarker = `vitest-pg-check-${crypto.randomUUID()}`;
    const insertRes = await db
      .from("support_messages")
      .insert({
        first_name: "Test",
        last_name: "Connectivity",
        email: `${testMarker}@example.invalid`,
        phone: "0550000000",
        message: testMarker,
      })
      .select("id, message")
      .single();

    expect(insertRes.error).toBeNull();
    expect(insertRes.data?.id).toBeTruthy();
    const createdId = insertRes.data.id as string;

    try {
      // Read back via Drizzle
      const [fetched] = await db.drizzle
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.id, createdId));
      expect(fetched).toBeDefined();
      expect(fetched.message).toBe(testMarker);

      // Update controlled test record
      const updatedMarker = `${testMarker}-updated`;
      const updateRes = await db
        .from("support_messages")
        .update({ message: updatedMarker })
        .eq("id", createdId)
        .select("id, message")
        .single();
      expect(updateRes.error).toBeNull();
      expect(updateRes.data?.message).toBe(updatedMarker);

      // Verify transaction rollback leaves zero trace
      const rollbackMarker = `vitest-pg-rollback-${crypto.randomUUID()}`;
      await expect(
        withDbTransaction(async (tx) => {
          await tx.insert(supportMessages).values({
            firstName: "Rollback",
            lastName: "Check",
            email: `${rollbackMarker}@example.invalid`,
            phone: "0550000001",
            message: rollbackMarker,
          });
          throw new Error("Intentional rollback verification");
        }, LIVE_URL!),
      ).rejects.toThrowError(/Intentional rollback verification/);

      const rolledBack = await db.drizzle
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.message, rollbackMarker));
      expect(rolledBack).toHaveLength(0);
    } finally {
      // Clean up ONLY the controlled test record
      const delRes = await db.from("support_messages").delete().eq("id", createdId);
      expect(delRes.error).toBeNull();

      const verifyGone = await db
        .from("support_messages")
        .select("id")
        .eq("id", createdId)
        .maybeSingle();
      expect(verifyGone.data).toBeNull();
    }
  });
});
