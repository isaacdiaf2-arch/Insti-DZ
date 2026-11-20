import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sortRoleRows } from "@/lib/auth.shared";

/**
 * Hidden platform-admin entry: verifies against independent database that caller holds
 * platform_admin role. Auto-elevation only occurs when PLATFORM_OWNER_EMAIL is explicitly configured.
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

    const owner = (process.env["PLATFORM_OWNER_EMAIL"] ?? "").toLowerCase().trim();
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

    const { data: roleRows } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", profile.id);

    const role = sortRoleRows(roleRows)[0]?.role ?? "student";
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
    const { authService } = await import("@/server/auth/auth.service");
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

    if (request.target === "platform_admin") {
      if (!isPlatform) throw new Error("غير مسموح بمعالجة هذا الطلب.");
      const { requirePlatformAdmin } = await import("@/lib/contracts.server");
      await requirePlatformAdmin(context);
    } else if (!isPlatform && (!myInstitution || myInstitution !== request.institution_id)) {
      throw new Error("غير مسموح بمعالجة هذا الطلب.");
    }

    if (data.action === "reject") {
      await db
        .from("password_reset_requests")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .eq("id", request.id);
      return { ok: true as const, tempCode: null };
    }

    if (!request.user_id) throw new Error("الحساب غير موجود.");

    const { randomInt } = await import("node:crypto");
    const password =
      data.action === "temp_code"
        ? `SDZ-${randomInt(100000, 999999)}-${randomInt(10, 99)}`
        : data.newPassword;
    if (!password || password.length < 8) throw new Error("كلمة المرور يجب أن تكون 8 أحرف فأكثر.");

    // Persist real bcrypt password_hash on the user's profile and record audit log
    await authService(db).setPasswordByAdmin(request.user_id, password, context.userId);

    const { error: resetErr } = await db
      .from("password_reset_requests")
      .update({
        status: "resolved",
        temp_code: null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    if (resetErr) throw new Error(resetErr.message);

    return { ok: true as const, tempCode: data.action === "temp_code" ? password : null };
  });

/**
 * Authenticated password change: verifies current password via bcrypt before updating password_hash.
 */
export const changeMyPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8).max(72),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const { authService } = await import("@/server/auth/auth.service");
    const db = await getServiceDb();
    await authService(db).changePassword(context.userId, data.currentPassword, data.newPassword);
    return { ok: true as const };
  });

/**
 * Independent credentials authentication server function.
 * Enforces server-side rate limiting, verifies credentials, issues either a pending 2FA challenge
 * or a signed session token, and records the login attempt strictly on the server.
 */
export const loginWithCredentials = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        email: z.string().trim().email(),
        password: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const { authService, AuthError } = await import("@/server/auth/auth.service");
    const {
      countFailedLoginAttemptsSafe,
      LOGIN_LOCKOUT_MINUTES,
      MAX_LOGIN_ATTEMPTS,
      recordServerLoginAttempt,
    } = await import("@/lib/rate-limit.functions");

    const db = await getServiceDb();
    const identifier = data.email.trim().toLowerCase();
    const since = new Date(Date.now() - LOGIN_LOCKOUT_MINUTES * 60 * 1000).toISOString();

    let failedCount: number;
    try {
      failedCount = await countFailedLoginAttemptsSafe(db, identifier, since);
    } catch {
      throw new Error("تعذر التحقق من حد المحاولات مؤقتًا. حاول بعد قليل.");
    }

    if (failedCount >= MAX_LOGIN_ATTEMPTS) {
      throw new Error("تم تجاوز الحد المسموح من المحاولات الفاشلة. حاول بعد 60 ثانية.");
    }

    const { applyServerSessionCookie, getClientMeta } = await import("@/lib/auth-session.server");
    const service = authService(db);
    try {
      const result = await service.authenticateUser(identifier, data.password, getClientMeta());
      await recordServerLoginAttempt(db, identifier, true);
      if (!result.requiresTotp && result.token) {
        applyServerSessionCookie(result.token);
      }
      return result;
    } catch (err) {
      if (err instanceof AuthError && err.statusCode === 401) {
        await recordServerLoginAttempt(db, identifier, false);
      }
      throw err;
    }
  });

/**
 * Completes the 2FA step after password authentication using the signed pending challenge token.
 */
export const completeTotpLogin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        challengeToken: z.string().min(10).max(2000),
        code: z.string().trim().min(6).max(16),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const { getAuthSecret, verifyTotpChallengeToken } = await import("@/server/auth/crypto");
    const { authService } = await import("@/server/auth/auth.service");
    const { verifyTotpOrBackupCode } = await import("@/lib/totp.functions");
    const {
      countFailedLoginAttemptsSafe,
      LOGIN_LOCKOUT_MINUTES,
      MAX_LOGIN_ATTEMPTS,
      recordServerLoginAttempt,
    } = await import("@/lib/rate-limit.functions");

    const secret = getAuthSecret();
    const check = verifyTotpChallengeToken(data.challengeToken, secret);
    if (!check.valid || !check.payload?.userId) {
      throw new Error("انتهت صلاحية جلسة التحقق بخطوتين. يرجى إعادة تسجيل الدخول.");
    }

    const db = await getServiceDb();
    const totpIdentifier = `totp:${check.payload.email.trim().toLowerCase()}`;
    const since = new Date(Date.now() - LOGIN_LOCKOUT_MINUTES * 60 * 1000).toISOString();

    let failedCount: number;
    try {
      failedCount = await countFailedLoginAttemptsSafe(db, totpIdentifier, since);
    } catch {
      throw new Error("تعذر التحقق من حد المحاولات مؤقتًا.");
    }

    if (failedCount >= MAX_LOGIN_ATTEMPTS) {
      throw new Error("تم تجاوز الحد المسموح من رموز التحقق الفاشلة. حاول بعد 60 ثانية.");
    }

    const result = await verifyTotpOrBackupCode(db, check.payload.userId, data.code, secret);
    if (!result.verified) {
      await recordServerLoginAttempt(db, totpIdentifier, false);
      throw new Error("رمز التحقق غير صحيح أو منتهي الصلاحية.");
    }

    const { applyServerSessionCookie, getClientMeta } = await import("@/lib/auth-session.server");
    await recordServerLoginAttempt(db, totpIdentifier, true);
    const session = await authService(db, secret).issueSessionAfterTotp(check.payload.userId, getClientMeta());
    if (session.token) {
      applyServerSessionCookie(session.token);
    }
    return session;
  });

export const logoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const { authService } = await import("@/server/auth/auth.service");
    const { clearServerSessionCookie } = await import("@/lib/auth-session.server");
    const db = await getServiceDb();
    if (context.sessionId) {
      await authService(db).revokeSession(context.sessionId, context.userId);
    }
    clearServerSessionCookie();
    return { ok: true as const };
  });

export const logoutAllSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const { authService } = await import("@/server/auth/auth.service");
    const { clearServerSessionCookie } = await import("@/lib/auth-session.server");
    const db = await getServiceDb();
    await authService(db).revokeAllUserSessions(context.userId);
    clearServerSessionCookie();
    return { ok: true as const };
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
      db
        .from("profiles")
        .select("id, email, first_name, last_name, phone, institution_id, avatar_url, totp_enabled, created_at")
        .eq("id", userId)
        .maybeSingle(),
      db.from("user_roles").select("role, institution_id").eq("user_id", userId),
    ]);

    const sortedRoles = sortRoleRows(roles);
    let institution = null;
    const instId = profile?.institution_id || ((sortedRoles[0] as { institution_id?: string | null } | undefined)?.institution_id ?? null);
    if (instId) {
      const { data } = await db.from("institutions").select("*").eq("id", instId).maybeSingle();
      institution = data;
    }

    const role = sortedRoles[0]?.role ?? context.claims.role ?? "student";
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
