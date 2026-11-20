import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEMO_ACCOUNTS, DEMO_INSTITUTION_EMAIL, type DemoRoleKey } from "./demo.shared";
import { getAuthSecret, hashPassword, SESSION_TTL_SECONDS, signSessionToken } from "@/server/auth/crypto";

export function isDemoModeAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_DEMO_MODE === "true";
}

/**
 * Provisions (idempotently) the shared demo environment: one demo institution
 * with a demo institution admin, teacher and student.
 * Strictly disabled in production.
 */
export const startDemoSession = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ role: z.enum(["institution_admin", "teacher", "student"]) }).parse(data),
  )
  .handler(async ({ data }) => {
    if (!isDemoModeAllowed()) {
      throw new Error("وضع التجربة غير متاح في بيئة الإنتاج.");
    }
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    // 1. Demo institution
    const { data: existingInst } = await db
      .from("institutions")
      .select("id")
      .eq("email", DEMO_INSTITUTION_EMAIL)
      .maybeSingle();

    let institutionId = existingInst?.id ?? "00000000-0000-0000-0000-000000000001";
    if (!existingInst) {
      const { data: inserted } = await db
        .from("institutions")
        .insert({
          id: institutionId,
          name: "مؤسسة Insti DZ التجريبية",
          name_fr: "Etablissement Demo Insti DZ",
          type: "مدرسة خاصة",
          wilaya: "الجزائر",
          commune: "بئر مراد رايس",
          phone: "000000000",
          email: DEMO_INSTITUTION_EMAIL,
          status: "active",
          is_trial: false,
        })
        .select("id")
        .single();
      if (inserted?.id) institutionId = inserted.id;
    }

    // 2. Demo class
    const { data: existingClass } = await db
      .from("classes")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("name", "قسم تجريبي")
      .maybeSingle();

    let classId = existingClass?.id ?? "cccccccc-cccc-cccc-cccc-cccccccccccc";
    if (!existingClass) {
      const { data: inserted } = await db
        .from("classes")
        .insert({ id: classId, institution_id: institutionId, name: "قسم تجريبي", stage: "متوسط" })
        .select("id")
        .single();
      if (inserted?.id) classId = inserted.id;
    }

    const demoUserIds: Record<DemoRoleKey, string> = {
      institution_admin: "11111111-1111-1111-1111-111111111111",
      teacher: "22222222-2222-2222-2222-222222222222",
      student: "33333333-3333-3333-3333-333333333333",
    };

    async function ensureUser(key: DemoRoleKey) {
      const account = DEMO_ACCOUNTS[key];
      const targetId = demoUserIds[key];

      await db.from("profiles").upsert(
        {
          id: targetId,
          email: account.email,
          first_name: account.firstName,
          last_name: account.lastName,
          institution_id: institutionId,
          password_hash: hashPassword(account.password),
          totp_enabled: false,
        },
        { onConflict: "id" },
      );

      await db.from("user_roles").upsert(
        { user_id: targetId, role: key, institution_id: institutionId },
        { onConflict: "user_id,role" },
      );

      return targetId;
    }

    await ensureUser("institution_admin");
    const teacherId = await ensureUser("teacher");
    const studentId = await ensureUser("student");

    // 4. Demo subject + enrollment
    if (classId) {
      const { data: subject } = await db
        .from("subjects")
        .select("id")
        .eq("institution_id", institutionId)
        .eq("class_id", classId)
        .eq("name", "الرياضيات")
        .maybeSingle();
      if (!subject) {
        await db.from("subjects").insert({
          id: "ssssssss-ssss-ssss-ssss-ssssssssssss",
          institution_id: institutionId,
          class_id: classId,
          name: "الرياضيات",
          teacher_id: teacherId,
        });
      }

      const { data: enrollment } = await db
        .from("enrollments")
        .select("id")
        .eq("student_id", studentId)
        .eq("class_id", classId)
        .maybeSingle();
      if (!enrollment) {
        const { error: enrErr } = await db.from("enrollments").insert({
          institution_id: institutionId,
          class_id: classId,
          student_id: studentId,
        });
        if (enrErr) throw new Error(enrErr.message);
      }
    }

    const account = DEMO_ACCOUNTS[data.role];
    const targetUserId = demoUserIds[data.role];
    const authSecret = getAuthSecret();
    const sessionId = randomUUID();

    const { authRepository } = await import("@/server/auth/auth.repository");
    await authRepository(db).createSession({
      id: sessionId,
      user_id: targetUserId,
      institution_id: institutionId,
      roles: [data.role],
      expires_at: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
    });

    const token = signSessionToken(
      {
        userId: targetUserId,
        email: account.email,
        role: data.role,
        institutionId,
        sessionId,
      },
      authSecret,
      SESSION_TTL_SECONDS,
    );

    const { applyServerSessionCookie } = await import("@/lib/auth-session.server");
    applyServerSessionCookie(token);

    return {
      ok: true as const,
      email: account.email,
      password: account.password,
      token,
      userId: targetUserId,
    };
  });
