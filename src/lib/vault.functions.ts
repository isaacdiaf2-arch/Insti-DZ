import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Reserved entry point.
 *
 * No credential exists in this file: the expected identifier and passcode live
 * only in encrypted server-side environment secrets and are compared with a
 * constant-time digest comparison inside the handler (never shipped to the
 * browser bundle).
 */
export const openReservedConsole = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        identifier: z.string().trim().min(1).max(255),
        passcode: z.string().min(1).max(255),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { createHash, timingSafeEqual } = await import("node:crypto");
    const { getServiceDb } = await import("@/server/db/adapter");
    const { authService } = await import("@/server/auth/auth.service");
    const { applyServerSessionCookie } = await import("@/lib/auth-session.server");
    const {
      countFailedLoginAttemptsSafe,
      LOGIN_LOCKOUT_MINUTES,
      MAX_LOGIN_ATTEMPTS,
      recordServerLoginAttempt,
    } = await import("@/lib/rate-limit.functions");

    const db = await getServiceDb();
    const attemptKey = `vault:${data.identifier.trim().toLowerCase()}`;
    const since = new Date(Date.now() - LOGIN_LOCKOUT_MINUTES * 60 * 1000).toISOString();

    let failedCount: number;
    try {
      failedCount = await countFailedLoginAttemptsSafe(db, attemptKey, since);
    } catch {
      throw new Error("تعذر التحقق من حد المحاولات مؤقتًا. حاول بعد قليل.");
    }
    if (failedCount >= MAX_LOGIN_ATTEMPTS) {
      throw new Error("تم تجاوز الحد المسموح من المحاولات الفاشلة. حاول بعد قليل.");
    }

    const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
    const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

    const expectedId = process.env["SDZ_VAULT_IDENTIFIER"] ?? "";
    const expectedPass = process.env["SDZ_VAULT_PASSCODE"] ?? "";
    const accountEmail = process.env["SDZ_VAULT_EMAIL"] ?? "";
    if (!expectedId || !expectedPass || !accountEmail) {
      return {
        ok: false as const,
        requiresTotp: false as const,
        challengeToken: null,
        accessToken: null,
      };
    }

    const okId = same(data.identifier.toLowerCase(), expectedId.toLowerCase());
    const okPass = same(data.passcode, expectedPass);
    if (!okId || !okPass) {
      await recordServerLoginAttempt(db, attemptKey, false);
      return {
        ok: false as const,
        requiresTotp: false as const,
        challengeToken: null,
        accessToken: null,
      };
    }

    await recordServerLoginAttempt(db, attemptKey, true);

    const { data: existing } = await db
      .from("profiles")
      .select("id")
      .ilike("email", accountEmail)
      .maybeSingle();

    let userId = existing?.id as string | undefined;
    if (!userId) {
      const { data: created, error } = await db.auth.admin.createUser({
        email: accountEmail,
        password: expectedPass,
        email_confirm: true,
        user_metadata: { first_name: "مدير", last_name: "المنصة" },
      });
      if (error || !created.user) {
        return {
          ok: false as const,
          requiresTotp: false as const,
          challengeToken: null,
          accessToken: null,
        };
      }
      userId = created.user.id;
    }

    await db
      .from("user_roles")
      .upsert({ user_id: userId, role: "platform_admin" }, { onConflict: "user_id,role" });

    const authResult = await authService(db).issueSessionOrChallengeForUser(userId);
    if (!authResult.requiresTotp && authResult.token) {
      applyServerSessionCookie(authResult.token);
    }

    return {
      ok: true as const,
      requiresTotp: authResult.requiresTotp,
      challengeToken: authResult.challengeToken,
      accessToken: authResult.token,
      refreshToken: "",
    };
  });
