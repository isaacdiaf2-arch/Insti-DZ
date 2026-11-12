import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PLATFORM_OWNER_EMAIL = "isaacdiaf2@gmail.com";

/**
 * Hidden platform-admin entry: verifies against independent database that caller holds
 * platform_admin role.
 */
export const verifyPlatformAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    const { data } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "platform_admin")
      .maybeSingle();
    if (data) return { isPlatformAdmin: true };

    const owner = (process.env["PLATFORM_OWNER_EMAIL"] ?? PLATFORM_OWNER_EMAIL).toLowerCase().trim();
    const email = String(context.claims.email ?? "").toLowerCase().trim();
    if (owner && email && owner === email) {
      await db
        .from("user_roles")
        .upsert({ user_id: context.userId, role: "platform_admin" }, { onConflict: "user_id,role" });
      return { isPlatformAdmin: true };
    }
    return { isPlatformAdmin: false };
  });

/** Public: a user who forgot their password sends a request to the responsible admin. */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ identifier: z.string().trim().min(3).max(255) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    const { data: profile } = await db
      .from("profiles")
      .select("id, email, first_name, last_name, institution_id")
      .ilike("email", data.identifier)
      .maybeSingle();

    if (!profile) {
      // No account enumeration: same response either way.
      return { ok: true as const, target: null };
    }

    const { data: roleRow } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", profile.id)
      .maybeSingle();

    const role = roleRow?.role ?? "student";
    const target = role === "institution_admin" || role === "platform_admin"
      ? "platform_admin"
      : "institution_admin";

    const { data: existing } = await db
      .from("password_reset_requests")
      .select("id")
      .eq("user_id", profile.id)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) return { ok: true as const, target };

    const { error } = await db.from("password_reset_requests").insert({
      user_id: profile.id,
      email: profile.email,
      full_name: `${profile.first_name} ${profile.last_name}`.trim(),
      role,
      institution_id: profile.institution_id,
      target,
      status: "pending",
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, target };
  });

export const resolvePasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        action: z.enum(["set_password", "temp_code", "reject"]),
        newPassword: z.string().min(8).max(72).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();

    const { data: request } = await db
      .from("password_reset_requests")
      .select("*")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!request) throw new Error("الطلب غير موجود.");

    const { data: myRoles } = await db
      .from("user_roles")
      .select("role, institution_id")
      .eq("user_id", context.userId);

    const isPlatform = (myRoles ?? []).some((r: any) => r.role === "platform_admin");
    const myInstitution = (myRoles ?? []).find((r: any) => r.role === "institution_admin")?.institution_id;

    const allowed =
      request.target === "platform_admin"
        ? isPlatform
        : isPlatform || (!!myInstitution && myInstitution === request.institution_id);
    if (!allowed) throw new Error("غير مسموح بمعالجة هذا الطلب.");

    if (data.action === "reject") {
      await db
        .from("password_reset_requests")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .eq("id", request.id);
      return { ok: true as const, tempCode: null };
    }

    if (!request.user_id) throw new Error("الحساب غير موجود.");

    const password =
      data.action === "temp_code"
        ? `SDZ${Math.floor(100000 + Math.random() * 900000)}`
        : data.newPassword;
    if (!password || password.length < 8) throw new Error("كلمة المرور يجب أن تكون 8 أحرف فأكثر.");

    // Update password hash if auth credentials table exists
    const { hashPassword } = await import("@/server/auth/crypto");
    const newHash = hashPassword(password);
    await db.from("profiles").update({ updated_at: new Date().toISOString() }).eq("id", request.user_id);
    await db.from("auth_credentials").upsert({ user_id: request.user_id, password_hash: newHash }, { onConflict: "user_id" });

    await db
      .from("password_reset_requests")
      .update({
        status: "resolved",
        temp_code: data.action === "temp_code" ? password : null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", request.id);

    return { ok: true as const, tempCode: data.action === "temp_code" ? password : null };
  });

/**
 * Independent credentials authentication server function.
 * Verifies credentials, tenant status, issues session token, and logs audit event via authService.
 */
export const loginWithCredentials = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        email: z.string().trim().email(),
        password: z.string().min(1),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const { authService } = await import("@/server/auth/auth.service");
    const db = await getServiceDb();
    const service = authService(db);
    return service.authenticateUser(data.email, data.password);
  });

/**
 * Loads current user account profile, assigned roles, and institution status via independent backend.
 */
export const getAccountProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const userId = context.userId;

    const [{ data: profile }, { data: roles }] = await Promise.all([
      db.from("profiles").select("*").eq("id", userId).maybeSingle(),
      db.from("user_roles").select("role, institution_id").eq("user_id", userId),
    ]);

    let institution = null;
    const instId = profile?.institution_id || (roles?.[0]?.institution_id ?? null);
    if (instId) {
      const { data } = await db.from("institutions").select("*").eq("id", instId).maybeSingle();
      institution = data;
    }

    const role = (roles?.[0]?.role ?? context.claims.role ?? "student");
    const user = {
      id: userId,
      email: profile?.email || context.claims.email || "",
      user_metadata: {
        first_name: profile?.first_name || "",
        last_name: profile?.last_name || "",
      },
    };

    return { user, profile, role, institution };
  });
