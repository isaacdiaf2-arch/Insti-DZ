import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hashPassword } from "@/server/auth/crypto";

const institutionSchema = z.object({
  name: z.string().min(2),
  type: z.string().min(2),
  wilaya: z.string().min(1),
  commune: z.string().min(1),
  address: z.string().optional().default(""),
  phone: z.string().min(6),
  email: z.string().email(),
  managerPhone: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

export const registerInstitution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => institutionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const userId = context.userId;

    const { data: existingProfile } = await db
      .from("profiles")
      .select("institution_id")
      .eq("id", userId)
      .maybeSingle();

    if (existingProfile?.institution_id) {
      throw new Error("لا يمكن فتح أكثر من حساب مؤسسة واحد لنفس المستخدم.");
    }

    const { data: phoneTaken } = await db
      .from("profiles")
      .select("id")
      .eq("phone", data.managerPhone)
      .neq("id", userId)
      .maybeSingle();
    if (phoneTaken) throw new Error("رقم الهاتف مستعمل في حساب آخر.");

    const { data: institution, error: instError } = await db
      .from("institutions")
      .insert({
        name: data.name,
        type: data.type,
        wilaya: data.wilaya,
        commune: data.commune,
        address: data.address,
        phone: data.phone,
        email: data.email,
        owner_id: userId,
        status: "pending",
      })
      .select("id")
      .single();
    if (instError || !institution) throw new Error(instError?.message || "تعذر إنشاء المؤسسة.");

    const { error: profileError } = await db
      .from("profiles")
      .update({
        institution_id: institution.id,
        first_name: data.firstName,
        last_name: data.lastName,
        phone: data.managerPhone,
      })
      .eq("id", userId);
    if (profileError) {
      await db.from("institutions").delete().eq("id", institution.id);
      throw new Error(profileError.message);
    }

    const { error: roleErr } = await db
      .from("user_roles")
      .upsert(
        { user_id: userId, role: "institution_admin", institution_id: institution.id },
        { onConflict: "user_id,role" },
      );
    if (roleErr) {
      await db.from("profiles").update({ institution_id: null }).eq("id", userId);
      await db.from("institutions").delete().eq("id", institution.id);
      throw new Error(roleErr.message);
    }

    await db.from("contracts").insert({
      institution_id: institution.id,
      body: "عقد اشتراك سنوي بين إدارة منصة Insti DZ ومدير المؤسسة، مدته سنة كاملة بمبلغ 9,000 دج، يُجدَّد بعد الدفع والمراجعة.",
    });

    return { institutionId: institution.id };
  });

export const bootstrapRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const ownerEmail = (process.env["PLATFORM_OWNER_EMAIL"] ?? "").toLowerCase().trim();
    const email = String(context.claims.email ?? "").toLowerCase().trim();
    if (!ownerEmail || !email || email !== ownerEmail) return { role: null };
    await db
      .from("user_roles")
      .upsert({ user_id: context.userId, role: "platform_admin" }, { onConflict: "user_id,role" });
    return { role: "platform_admin" as const };
  });

const memberSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(6),
  role: z.enum(["teacher", "student"]),
  classId: z.string().uuid().optional().nullable(),
});

export const createMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => memberSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    const { data: adminRole } = await db
      .from("user_roles")
      .select("role, institution_id")
      .eq("user_id", context.userId)
      .eq("role", "institution_admin")
      .maybeSingle();
    if (!adminRole?.institution_id) throw new Error("غير مسموح: هذه العملية لمدير المؤسسة فقط.");
    const institutionId = adminRole.institution_id;

    const { data: emailTaken } = await db
      .from("profiles")
      .select("id")
      .ilike("email", data.email)
      .maybeSingle();
    if (emailTaken) throw new Error("البريد الإلكتروني مستعمل مسبقًا.");

    const { data: phoneTaken } = await db
      .from("profiles")
      .select("id")
      .eq("phone", data.phone)
      .maybeSingle();
    if (phoneTaken) throw new Error("رقم الهاتف مستعمل مسبقًا.");

    if (data.classId) {
      const { data: cls } = await db
        .from("classes")
        .select("institution_id")
        .eq("id", data.classId)
        .maybeSingle();
      if (!cls || cls.institution_id !== institutionId) {
        throw new Error("القسم المحدد لا ينتمي إلى مؤسستك.");
      }
    }

    const newUserId = crypto.randomUUID();
    const passwordHash = hashPassword(data.password);

    const { error: profErr } = await db.from("profiles").upsert({
      id: newUserId,
      institution_id: institutionId,
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email.toLowerCase().trim(),
      phone: data.phone,
      password_hash: passwordHash,
      totp_enabled: false,
    });
    if (profErr) throw new Error(profErr.message);

    const { error: roleErr } = await db
      .from("user_roles")
      .upsert(
        { user_id: newUserId, role: data.role, institution_id: institutionId },
        { onConflict: "user_id,role" },
      );
    if (roleErr) {
      await db.from("profiles").delete().eq("id", newUserId);
      throw new Error(roleErr.message);
    }

    if (data.role === "student" && data.classId) {
      const { error: enrErr } = await db.from("enrollments").upsert(
        {
          institution_id: institutionId,
          student_id: newUserId,
          class_id: data.classId,
        },
        { onConflict: "student_id,class_id" },
      );
      if (enrErr) {
        await db.from("user_roles").delete().eq("user_id", newUserId);
        await db.from("profiles").delete().eq("id", newUserId);
        throw new Error(enrErr.message);
      }
    }

    return { userId: newUserId };
  });

export const deleteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    const { data: adminRole } = await db
      .from("user_roles")
      .select("institution_id")
      .eq("user_id", context.userId)
      .eq("role", "institution_admin")
      .maybeSingle();
    if (!adminRole?.institution_id) throw new Error("غير مسموح.");

    if (data.userId === context.userId) throw new Error("لا يمكنك حذف حسابك الخاص.");
    const { data: target } = await db
      .from("profiles")
      .select("institution_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (target?.institution_id !== adminRole.institution_id) throw new Error("غير مسموح.");

    const { data: targetRoles } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if ((targetRoles ?? []).some((r: any) => r.role === "platform_admin")) {
      throw new Error("غير مسموح.");
    }

    await db.from("user_roles").delete().eq("user_id", data.userId);
    await db.from("enrollments").delete().eq("student_id", data.userId);
    const { error: delErr } = await db.from("profiles").delete().eq("id", data.userId);
    if (delErr) throw new Error(delErr.message);
    return { ok: true };
  });

export const transferStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ studentId: z.string().uuid(), targetInstitutionId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    const { requirePlatformAdmin } = await import("./contracts.server");
    await requirePlatformAdmin(context);

    const { data: target } = await db
      .from("institutions")
      .select("id, status")
      .eq("id", data.targetInstitutionId)
      .maybeSingle();
    if (!target) throw new Error("المؤسسة المستقبِلة غير موجودة.");
    if (target.status !== "active") throw new Error("المؤسسة المستقبِلة غير نشطة.");

    const { data: student } = await db
      .from("profiles")
      .select("institution_id")
      .eq("id", data.studentId)
      .maybeSingle();
    if (!student) throw new Error("الطالب غير موجود.");
    if (student.institution_id === data.targetInstitutionId) return { ok: true };

    await db.from("enrollments").delete().eq("student_id", data.studentId);
    await db
      .from("profiles")
      .update({ institution_id: data.targetInstitutionId })
      .eq("id", data.studentId);
    await db
      .from("user_roles")
      .update({ institution_id: data.targetInstitutionId })
      .eq("user_id", data.studentId);
    return { ok: true };
  });

const supportSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  institutionName: z.string().optional().default(""),
  wilaya: z.string().optional().default(""),
  commune: z.string().optional().default(""),
  address: z.string().optional().default(""),
  phone: z.string().min(6),
  email: z.string().email(),
  message: z.string().optional().default(""),
});

export const sendSupportMessage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => supportSchema.parse(data))
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const { countRecentInboundSafe } = await import("@/lib/inbound.functions");
    const db = await getServiceDb();

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const count = await countRecentInboundSafe(
      db,
      "count_recent_support_messages",
      data.email,
      since,
    );
    if (count >= 5) {
      throw new Error("تم إرسال عدة رسائل مؤخرًا، حاول لاحقًا.");
    }

    const { error } = await db.from("support_messages").insert({
      first_name: data.firstName,
      last_name: data.lastName,
      institution_name: data.institutionName,
      wilaya: data.wilaya,
      commune: data.commune,
      address: data.address,
      phone: data.phone,
      email: data.email.trim().toLowerCase(),
      message: data.message,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setInstitutionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        institutionId: z.string().uuid(),
        status: z.enum(["pending", "active", "suspended", "expired"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { requirePlatformAdmin } = await import("./contracts.server");
    await requirePlatformAdmin(context);

    const { error } = await db
      .from("institutions")
      .update({ status: data.status })
      .eq("id", data.institutionId);
    if (error) throw new Error(error.message);

    await db.from("audit_logs").insert({
      actor_id: context.userId,
      actor_role: "platform_admin",
      institution_id: data.institutionId,
      action: `institution.status.${data.status}`,
      resource: "institutions",
      resource_id: data.institutionId,
      result: "success",
      metadata: {} as never,
    });

    return { ok: true };
  });

export const getPlatformAdminDashboardData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requirePlatformAdmin } = await import("./contracts.server");
    await requirePlatformAdmin(context);
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    const [
      institutionsRes,
      paymentsRes,
      profilesRes,
      rolesRes,
      contractsRes,
      eventsRes,
      supportRes,
      resetsRes,
      trialsRes,
    ] = await Promise.all([
      db.from("institutions").select("*").order("created_at", { ascending: false }).limit(200),
      db.from("payments").select("*, institutions(name)").order("created_at", { ascending: false }).limit(200),
      db
        .from("profiles")
        .select("id, email, first_name, last_name, phone, institution_id, totp_enabled, created_at, institutions(name)")
        .order("created_at", { ascending: false })
        .limit(200),
      db.from("user_roles").select("user_id, role"),
      db.from("contracts").select("*, institutions(name)").order("created_at", { ascending: false }).limit(200),
      db.from("contract_events").select("*, contracts(contract_number)").order("created_at", { ascending: false }).limit(100),
      db.from("support_messages").select("*").order("created_at", { ascending: false }),
      db.from("password_reset_requests").select("*").eq("target", "platform_admin").order("created_at", { ascending: false }),
      db.from("trial_requests").select("*").order("created_at", { ascending: false }),
    ]);

    return {
      institutions: institutionsRes.data ?? [],
      payments: paymentsRes.data ?? [],
      profiles: profilesRes.data ?? [],
      roles: rolesRes.data ?? [],
      contracts: contractsRes.data ?? [],
      events: eventsRes.data ?? [],
      support: supportRes.data ?? [],
      resets: resetsRes.data ?? [],
      trials: trialsRes.data ?? [],
    };
  });

