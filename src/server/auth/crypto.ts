import { pbkdf2Sync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = "sha256";

/**
 * Generates a cryptographically secure password hash with a random salt.
 * Output format: pbkdf2:sha256:iterations:saltHex:hashHex
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  return `pbkdf2:${DIGEST}:${PBKDF2_ITERATIONS}:${salt}:${hash}`;
}

/**
 * Verifies a plaintext password against a stored hash using timing-safe comparison.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !password) return false;
  const parts = storedHash.split(":");
  if (parts.length !== 5 || parts[0] !== "pbkdf2") {
    return false;
  }
  const [, digest, iterStr, salt, expectedHash] = parts;
  const iterations = parseInt(iterStr, 10);
  if (isNaN(iterations) || iterations < 10_000) return false;

  const derived = pbkdf2Sync(password, salt, iterations, Buffer.from(expectedHash, "hex").length, digest);
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  if (derived.length !== expectedBuffer.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}

/**
 * Signs an independent session token containing user payload and expiration.
 */
export function signSessionToken(payload: { userId: string; email: string; role: string; institutionId?: string | null }, secret: string, expiresInSeconds = 86400 * 7): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

/**
 * Verifies and parses an independent session token.
 */
export function verifySessionToken(token: string, secret: string): { valid: boolean; payload?: any; reason?: string } {
  if (!token || typeof token !== "string") return { valid: false, reason: "missing_token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed_token" };
  const [header, body, signature] = parts;
  const expectedSig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  
  if (signature.length !== expectedSig.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return { valid: false, reason: "invalid_signature" };
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, reason: "token_expired" };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }
}
