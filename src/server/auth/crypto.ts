import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import bcrypt from "bcryptjs";
import {
  SESSION_COOKIE_NAME,
  SESSION_STORAGE_KEY,
  SESSION_TTL_SECONDS,
} from "@/lib/auth.shared";

export { SESSION_COOKIE_NAME, SESSION_STORAGE_KEY, SESSION_TTL_SECONDS };

const BCRYPT_COST = 12;
const MIN_SECRET_LENGTH = 32;
const ENC_PREFIX = "enc:v1:";

/**
 * Returns the cryptographic HMAC secret from environment variables.
 * Fails loudly when missing or shorter than 32 characters — never uses a hardcoded fallback.
 */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.JWT_SECRET?.trim() || "";
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `[Auth] AUTH_SECRET environment variable is required and must be at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

/**
 * Hashes a plaintext password using bcrypt (cost 12).
 */
export function hashPassword(password: string): string {
  if (!password || typeof password !== "string") {
    throw new Error("كلمة المرور مطلوبة.");
  }
  return bcrypt.hashSync(password, BCRYPT_COST);
}

/**
 * Verifies a plaintext password against a stored bcrypt hash
 * (with backwards-compatible verification for legacy pbkdf2 hashes).
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !password || typeof storedHash !== "string" || typeof password !== "string") {
    return false;
  }

  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
    try {
      return bcrypt.compareSync(password, storedHash);
    } catch {
      return false;
    }
  }

  // Legacy pbkdf2:sha256:iterations:saltHex:hashHex verification
  const parts = storedHash.split(":");
  if (parts.length !== 5 || parts[0] !== "pbkdf2") {
    return false;
  }
  const [, digest, iterStr, salt, expectedHash] = parts;
  const iterations = parseInt(iterStr, 10);
  if (isNaN(iterations) || iterations < 10_000 || !salt || !expectedHash) return false;

  const expectedBuffer = Buffer.from(expectedHash, "hex");
  if (expectedBuffer.length === 0) return false;

  const derived = pbkdf2Sync(password, salt, iterations, expectedBuffer.length, digest);
  if (derived.length !== expectedBuffer.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}

function deriveAesKey(secret: string): Buffer {
  return createHash("sha256").update(`sdz:sensitive-aes256gcm:${secret}`).digest();
}

/**
 * Encrypts sensitive database fields (e.g. TOTP secrets) using AES-256-GCM.
 */
export function encryptSensitiveValue(plaintext: string, secret = getAuthSecret()): string {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("قيمة سرية غير صالحة للتشفير.");
  }
  const key = deriveAesKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

/**
 * Decrypts AES-256-GCM values prefixed with `enc:v1:`.
 * Falls back gracefully for legacy unencrypted Base32 values until re-enrolled.
 */
export function decryptSensitiveValue(stored: string, secret = getAuthSecret()): string {
  if (!stored || typeof stored !== "string") {
    throw new Error("القيمة السرية غير موجودة.");
  }
  if (!stored.startsWith(ENC_PREFIX)) {
    return stored;
  }
  const body = stored.slice(ENC_PREFIX.length);
  const parts = body.split(".");
  if (parts.length !== 3) {
    throw new Error("صيغة القيمة المشفرة غير صالحة.");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const key = deriveAesKey(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Produces a keyed SHA-256 hash of a one-time backup code so plaintext backup codes
 * are never persisted in PostgreSQL.
 */
export function hashBackupCode(code: string, secret = getAuthSecret()): string {
  const normalized = code.trim().toLowerCase();
  return `sha256:${createHmac("sha256", secret).update(`sdz:backup-code:${normalized}`).digest("hex")}`;
}

function verifyJwtRaw(
  token: string,
  secret: string,
): { valid: boolean; payload?: any; reason?: string } {
  if (!secret || typeof secret !== "string") {
    return { valid: false, reason: "missing_secret" };
  }
  if (!token || typeof token !== "string") return { valid: false, reason: "missing_token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed_token" };
  const [headerB64, bodyB64, signature] = parts;
  if (!headerB64 || !bodyB64 || !signature) return { valid: false, reason: "malformed_token" };

  try {
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8"));
    if (header?.alg !== "HS256" || header?.typ !== "JWT") {
      return { valid: false, reason: "invalid_header" };
    }
  } catch {
    return { valid: false, reason: "invalid_header" };
  }

  const expectedSig = createHmac("sha256", secret)
    .update(`${headerB64}.${bodyB64}`)
    .digest("base64url");

  if (
    signature.length !== expectedSig.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))
  ) {
    return { valid: false, reason: "invalid_signature" };
  }

  try {
    const payload = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf-8"));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp <= now) {
      return { valid: false, reason: "token_expired" };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }
}

/**
 * Signs an independent HS256 JWT session token containing user payload and expiration.
 */
export function signSessionToken(
  payload: {
    userId: string;
    email: string;
    role: string;
    institutionId?: string | null;
    sessionId?: string;
  },
  secret: string,
  expiresInSeconds = SESSION_TTL_SECONDS,
): string {
  if (!secret || typeof secret !== "string") {
    throw new Error("[Auth] Cannot sign session token without a valid AUTH_SECRET.");
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ ...payload, scope: "session", iat: now, exp: now + expiresInSeconds }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

/**
 * Signs a short-lived pending-2FA challenge token that CANNOT be used as a session bearer token.
 */
export function signTotpChallengeToken(
  payload: { userId: string; email: string },
  secret: string,
  expiresInSeconds = 300,
): string {
  if (!secret || typeof secret !== "string") {
    throw new Error("[Auth] Cannot sign 2FA challenge token without a valid AUTH_SECRET.");
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ ...payload, scope: "totp_pending", iat: now, exp: now + expiresInSeconds }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

/**
 * Verifies HS256 JWT signature, algorithm header, expiration, and rejects pending 2FA challenge tokens.
 */
export function verifySessionToken(
  token: string,
  secret: string,
): { valid: boolean; payload?: any; reason?: string } {
  const res = verifyJwtRaw(token, secret);
  if (!res.valid || !res.payload) return res;
  if (res.payload.scope && res.payload.scope !== "session") {
    return { valid: false, reason: "invalid_scope" };
  }
  return res;
}

/**
 * Verifies a pending 2FA challenge JWT issued after password authentication.
 */
export function verifyTotpChallengeToken(
  token: string,
  secret: string,
): { valid: boolean; payload?: { userId: string; email: string }; reason?: string } {
  const res = verifyJwtRaw(token, secret);
  if (!res.valid || !res.payload) return res;
  if (res.payload.scope !== "totp_pending") {
    return { valid: false, reason: "invalid_scope" };
  }
  return res;
}
