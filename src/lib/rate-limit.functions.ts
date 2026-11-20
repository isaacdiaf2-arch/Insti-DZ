import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MINUTES = 1;

/**
 * Queries failed login count strictly via SECURITY DEFINER SQL function `count_recent_failed_logins`.
 * Never falls back to direct table queries (even on 42883) and never fails silently to `0`.
 */
export async function countFailedLoginAttemptsSafe(
  db: any,
  identifier: string,
  since: string,
): Promise<number> {
  const { data: rpcCount, error: rpcError } = await db.rpc("count_recent_failed_logins", {
    _identifier: identifier,
    _since: since,
  });

  if (!rpcError && typeof rpcCount === "number" && Number.isFinite(rpcCount)) {
    return rpcCount;
  }

  console.error("[RateLimit] count_recent_failed_logins RPC failed:", rpcError?.message ?? "invalid response");
  throw new Error(rpcError?.message || "Rate-limit verification unavailable.");
}

/**
 * Server-only helper to record real login / TOTP verification outcomes in `login_attempts`.
 */
export async function recordServerLoginAttempt(
  db: any,
  identifier: string,
  success: boolean,
): Promise<void> {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return;
  const { error } = await db.from("login_attempts").insert({
    identifier: normalized,
    success,
  });
  if (error) {
    console.error("[RateLimit] Failed to persist login attempt:", error.message);
  }
}

export const checkLoginRateLimit = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ identifier: z.string().trim().min(1).max(255) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const normalized = data.identifier.trim().toLowerCase();
    const since = new Date(Date.now() - LOGIN_LOCKOUT_MINUTES * 60 * 1000).toISOString();

    let failedCount: number;
    try {
      failedCount = await countFailedLoginAttemptsSafe(supabaseAdmin, normalized, since);
    } catch (err: any) {
      console.error("[RateLimit] Blocking login check due to rate-limit failure:", err?.message);
      return { locked: true, waitSeconds: LOGIN_LOCKOUT_MINUTES * 60, error: "تعذر التحقق من حد المحاولات." };
    }

    if (failedCount >= MAX_LOGIN_ATTEMPTS) {
      return { locked: true, waitSeconds: LOGIN_LOCKOUT_MINUTES * 60 };
    }

    return { locked: false, waitSeconds: 0, remaining: MAX_LOGIN_ATTEMPTS - failedCount };
  });

/**
 * Deprecated client endpoint: untrusted browser callers cannot poison `login_attempts`
 * for arbitrary target emails (all real login attempts are recorded strictly server-side).
 */
export const recordLoginAttempt = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({
      identifier: z.string().trim().min(1).max(255),
      success: z.boolean(),
    }).parse(data),
  )
  .handler(async () => {
    return { ok: false as const, ignored: true as const };
  });
