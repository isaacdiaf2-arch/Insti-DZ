import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * 2FA / TOTP implementation for administrative accounts.
 * Uses RFC 6238 TOTP with AES-256-GCM encrypted secret storage and HMAC-SHA256 hashed backup codes.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const c of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, message as BufferSource);
  return new Uint8Array(sig);
}

export async function generateTotpForStep(secret: Uint8Array, timeStep: number): Promise<string> {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(timeStep / 2 ** 32));
  view.setUint32(4, timeStep >>> 0);

  const hmac = await hmacSha1(secret, new Uint8Array(buffer));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function matchesTotpWindow(secretBase32: string, code: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  if (secret.length === 0) return false;
  const currentStep = Math.floor(nowSec / 30);
  for (const offset of [-1, 0, 1]) {
    const expected = await generateTotpForStep(secret, currentStep + offset);
    if (expected === code) return true;
  }
  return false;
}

function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    codes.push(hex);
  }
  return codes;
}

/**
 * Verifies a 6-digit TOTP code OR a single-use backup code during 2FA login.
 * Decrypts AES-256-GCM stored secrets and removes any consumed backup code from DB.
 */
export async function verifyTotpOrBackupCode(
  db: any,
  userId: string,
  submittedCode: string,
  authSecret?: string,
): Promise<{ required: boolean; verified: boolean }> {
  const { decryptSensitiveValue, getAuthSecret, hashBackupCode } = await import(
    "@/server/auth/crypto"
  );
  const resolvedSecret = authSecret ?? getAuthSecret();

  const { data: profile, error } = db?.drizzle
    ? await db.rpc("auth_get_totp_record", { _user_id: userId })
    : await db
        .from("profiles")
        .select("totp_secret, totp_enabled, totp_backup_codes")
        .eq("id", userId)
        .maybeSingle();

  if (error) {
    throw new Error("تعذر التحقق من إعدادات المصادقة الثنائية.");
  }

  if (!profile?.totp_enabled || !profile?.totp_secret) {
    return { required: false, verified: true };
  }

  const normalizedCode = submittedCode.trim().toLowerCase();
  const decryptedBase32 = decryptSensitiveValue(profile.totp_secret, resolvedSecret);

  if (await matchesTotpWindow(decryptedBase32, normalizedCode)) {
    return { required: true, verified: true };
  }

  // Fallback check against single-use backup codes (stored hashed, or legacy plaintext)
  const storedCodes: string[] = Array.isArray(profile.totp_backup_codes)
    ? profile.totp_backup_codes
    : [];
  if (storedCodes.length > 0 && normalizedCode.length >= 6) {
    const candidateHash = hashBackupCode(normalizedCode, resolvedSecret);
    const matchIndex = storedCodes.findIndex(
      (entry) => entry === candidateHash || entry === normalizedCode,
    );
    if (matchIndex !== -1) {
      const remaining = storedCodes.filter((_, idx) => idx !== matchIndex);
      if (db?.drizzle) {
        await db.rpc("auth_update_totp_backup_codes", {
          _user_id: userId,
          _backup_codes: remaining,
        });
      } else {
        await db
          .from("profiles")
          .update({ totp_backup_codes: remaining })
          .eq("id", userId);
      }
      return { required: true, verified: true };
    }
  }

  return { required: true, verified: false };
}

async function requirePlatformAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", context.userId)
    .eq("role", "platform_admin")
    .maybeSingle();
  if (!data) {
    const { data: instAdmin } = await context.supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", context.userId)
      .eq("role", "institution_admin")
      .maybeSingle();
    if (!instAdmin) throw new Error("غير مسموح: هذه الميزة للحسابات الإدارية فقط.");
  }
}

/** Step 1: Generate a new TOTP secret, store AES-256-GCM encrypted in DB, and return URI once for local authenticator setup. */
export const enrollTotp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context as any);
    const [{ supabaseAdmin }, { encryptSensitiveValue, getAuthSecret }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/server/auth/crypto"),
    ]);

    const authSecret = getAuthSecret();
    const secretBytes = crypto.getRandomValues(new Uint8Array(20));
    const secret = base32Encode(secretBytes);
    const encryptedSecret = encryptSensitiveValue(secret, authSecret);

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("id", context.userId)
      .maybeSingle();

    const label = encodeURIComponent(
      `Insti DZ:${profile?.email ?? context.userId}`,
    );
    const issuer = encodeURIComponent("Insti DZ");
    const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;

    const { error } = (supabaseAdmin as any)?.drizzle
      ? await (supabaseAdmin as any).rpc("auth_set_totp_secret", {
          _user_id: context.userId,
          _totp_secret: encryptedSecret,
        })
      : await supabaseAdmin
          .from("profiles")
          .update({ totp_secret: encryptedSecret, totp_enabled: false })
          .eq("id", context.userId);
    if (error) throw new Error(error.message);

    return { secret, uri };
  });

/** Step 2: Verify a TOTP code to confirm enrollment and enable 2FA with hashed backup codes. */
export const confirmTotpEnrollment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ code: z.string().regex(/^\d{6}$/) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context as any);
    const [{ supabaseAdmin }, { decryptSensitiveValue, getAuthSecret, hashBackupCode }] =
      await Promise.all([
        import("@/integrations/supabase/client.server"),
        import("@/server/auth/crypto"),
      ]);
    const authSecret = getAuthSecret();

    const { data: profile } = (supabaseAdmin as any)?.drizzle
      ? await (supabaseAdmin as any).rpc("auth_get_totp_record", { _user_id: context.userId })
      : await supabaseAdmin
          .from("profiles")
          .select("totp_secret, totp_enabled")
          .eq("id", context.userId)
          .maybeSingle();

    if (!profile?.totp_secret) throw new Error("لم يبدأ تسجيل 2FA بعد.");
    if (profile.totp_enabled) throw new Error("2FA مفعّل بالفعل.");

    const decryptedSecret = decryptSensitiveValue(profile.totp_secret, authSecret);
    if (!(await matchesTotpWindow(decryptedSecret, data.code))) {
      throw new Error("رمز التحقق غير صحيح.");
    }

    const backupCodes = generateBackupCodes();
    const hashedBackupCodes = backupCodes.map((c) => hashBackupCode(c, authSecret));

    if ((supabaseAdmin as any)?.drizzle) {
      const { error: enableErr } = await (supabaseAdmin as any).rpc("auth_enable_totp", {
        _user_id: context.userId,
        _backup_codes: hashedBackupCodes,
      });
      if (enableErr) throw new Error(enableErr.message);
    } else {
      await supabaseAdmin
        .from("profiles")
        .update({ totp_enabled: true, totp_backup_codes: hashedBackupCodes })
        .eq("id", context.userId);
    }

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      actor_role: "admin",
      action: "2fa.enabled",
      resource: "profiles",
      resource_id: context.userId,
      result: "success",
      metadata: {} as never,
    });

    return { backupCodes };
  });

/** Verify a TOTP code for an already authenticated administrative session (e.g. step-up confirmation). */
export const verifyTotp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ code: z.string().trim().min(6).max(16) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return verifyTotpOrBackupCode(supabaseAdmin, context.userId, data.code);
  });

/** Check if the current user has 2FA enabled. */
export const checkTotpStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("totp_enabled")
      .eq("id", context.userId)
      .maybeSingle();
    return { enabled: profile?.totp_enabled ?? false };
  });

/** Disable 2FA (requires a valid TOTP code or backup code). */
export const disableTotp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ code: z.string().trim().min(6).max(16) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const check = await verifyTotpOrBackupCode(supabaseAdmin, context.userId, data.code);
    if (!check.required) throw new Error("2FA غير مفعّل.");
    if (!check.verified) throw new Error("رمز التحقق غير صحيح.");

    if ((supabaseAdmin as any)?.drizzle) {
      const { error: disErr } = await (supabaseAdmin as any).rpc("auth_disable_totp", {
        _user_id: context.userId,
      });
      if (disErr) throw new Error(disErr.message);
    } else {
      await supabaseAdmin
        .from("profiles")
        .update({ totp_secret: null, totp_enabled: false, totp_backup_codes: [] })
        .eq("id", context.userId);
    }

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      actor_role: "admin",
      action: "2fa.disabled",
      resource: "profiles",
      resource_id: context.userId,
      result: "success",
      metadata: {} as never,
    });

    return { ok: true as const };
  });
