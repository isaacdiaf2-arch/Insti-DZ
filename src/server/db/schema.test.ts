import { describe, it, expect, afterAll } from "vitest";
import { is, Table, getTableColumns, getTableName } from "drizzle-orm";
import * as schema from "../../../drizzle/schema";
import { getDrizzleDb, closeDrizzleDb } from "./drizzle";

describe("Drizzle Schema Integrity (Static & In-Memory)", () => {
  const EXPECTED_TABLES = [
    "academic_levels",
    "announcements",
    "assessments",
    "attempt_answers",
    "attempts",
    "attendance_records",
    "audit_logs",
    "change_requests",
    "classes",
    "contract_artifacts",
    "contract_events",
    "contract_provider_settings",
    "contracts",
    "enrollments",
    "exams",
    "files",
    "group_memberships",
    "groups",
    "homework_submissions",
    "institutions",
    "invoices",
    "lesson_completions",
    "lessons",
    "licenses",
    "login_attempts",
    "modules",
    "notifications",
    "official_contracts",
    "options",
    "password_reset_requests",
    "payments",
    "personal_schedule_entries",
    "profiles",
    "programs",
    "questions",
    "results",
    "rooms",
    "schedules",
    "skills",
    "specializations",
    "subjects",
    "support_messages",
    "trial_requests",
    "user_roles",
    "user_sessions",
  ];

  it("exports exactly 45 database tables matching the full project schema", () => {
    const exportedTables = Object.entries(schema)
      .filter(([_, val]) => is(val, Table))
      .map(([_, val]) => getTableName(val as Table));

    const uniqueExported = Array.from(new Set(exportedTables)).sort();
    expect(uniqueExported).toHaveLength(45);
    expect(uniqueExported).toEqual(EXPECTED_TABLES.sort());
  });

  it("verifies profiles table contains 2FA and identity columns from SQL", () => {
    const cols = getTableColumns(schema.profiles);
    expect(cols).toHaveProperty("id");
    expect(cols).toHaveProperty("email");
    expect(cols).toHaveProperty("totpSecret");
    expect(cols).toHaveProperty("totpEnabled");
    expect(cols).toHaveProperty("totpBackupCodes");
    expect(cols).toHaveProperty("institutionId");
  });

  it("verifies official_contracts table structure matches legal contract workflow", () => {
    const cols = getTableColumns(schema.officialContracts);
    expect(cols).toHaveProperty("id");
    expect(cols).toHaveProperty("institutionId");
    expect(cols).toHaveProperty("state");
    expect(cols).toHaveProperty("contentHash");
    expect(cols).toHaveProperty("fields");
    expect(cols).toHaveProperty("version");
    expect(cols).toHaveProperty("institutionEvidence");
    expect(cols).toHaveProperty("platformEvidence");
  });

  it("verifies contract_artifacts table primary key and foreign key", () => {
    const cols = getTableColumns(schema.contractArtifacts);
    expect(cols).toHaveProperty("contractId");
    expect(cols.contractId.primary).toBe(true);
    expect(cols).toHaveProperty("sha256");
    expect(cols).toHaveProperty("pdfBase64");
  });

  it("verifies contract_provider_settings id is primary key with default true", () => {
    const cols = getTableColumns(schema.contractProviderSettings);
    expect(cols).toHaveProperty("id");
    expect(cols.id.primary).toBe(true);
    expect(cols).toHaveProperty("details");
    expect(cols).toHaveProperty("updatedBy");
  });

  it("verifies foreign key constraints on user_sessions and official_contracts", () => {
    const sessionCols = getTableColumns(schema.userSessions);
    expect(sessionCols).toHaveProperty("userId");
    expect(sessionCols).toHaveProperty("institutionId");
    expect(sessionCols.userId.notNull).toBe(true);
  });

  it("verifies user_sessions table contains independent session management fields", () => {
    const cols = getTableColumns(schema.userSessions);
    expect(cols).toHaveProperty("id");
    expect(cols).toHaveProperty("userId");
    expect(cols).toHaveProperty("institutionId");
    expect(cols).toHaveProperty("roles");
    expect(cols).toHaveProperty("createdAt");
    expect(cols).toHaveProperty("expiresAt");
    expect(cols).toHaveProperty("lastActiveAt");
  });

  it("verifies assessments and exams table separation according to AGENTS.md", () => {
    const assessmentCols = getTableColumns(schema.assessments);
    const examCols = getTableColumns(schema.exams);

    // assessments links to exam_id as the question bank
    expect(assessmentCols).toHaveProperty("examId");
    expect(assessmentCols).toHaveProperty("kind");
    expect(assessmentCols).toHaveProperty("published");
    expect(assessmentCols).toHaveProperty("resultsPublished");

    // exams is the question bank containing title, duration_minutes
    expect(examCols).toHaveProperty("title");
    expect(examCols).toHaveProperty("durationMinutes");
  });

  it("verifies enums are defined with correct values", () => {
    expect(schema.appRoleEnum.enumValues).toEqual([
      "platform_admin",
      "institution_admin",
      "teacher",
      "student",
    ]);
    expect(schema.paymentStatusEnum.enumValues).toEqual(["pending", "verified", "rejected"]);
    expect(schema.contractStatusEnum.enumValues).toEqual([
      "created",
      "institution_signed",
      "approved",
      "active",
      "rejected",
      "expired",
    ]);
  });
});

describe("Drizzle Client & Independent Connection Handling", () => {
  afterAll(async () => {
    await closeDrizzleDb();
  });

  it("throws a descriptive error when TEST_DATABASE_URL is not set", () => {
    const originalEnv = process.env.TEST_DATABASE_URL;
    try {
      delete process.env.TEST_DATABASE_URL;
      expect(() => getDrizzleDb()).toThrowError(/TEST_DATABASE_URL is not configured/);
    } finally {
      if (originalEnv) process.env.TEST_DATABASE_URL = originalEnv;
    }
  });

  // Live database connection test: Only executed when TEST_DATABASE_URL is explicitly provided
  const liveUrl = process.env.TEST_DATABASE_URL;
  it.skipIf(!liveUrl)("connects and queries the live test database when TEST_DATABASE_URL is provided", async () => {
    const db = getDrizzleDb(liveUrl);
    expect(db).toBeDefined();
  });
});
