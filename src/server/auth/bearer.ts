import { getAuthSecret, verifySessionToken } from "./crypto";
import { authRepository } from "./auth.repository";
import { sortRoleRows } from "@/lib/auth.shared";
import type { DbClient } from "@/server/db/adapter";

export type BearerAuthContext = {
  supabase: DbClient;
  userId: string;
  sessionId: string | null;
  claims: {
    sub: string;
    email: string;
    role: string;
    roles: string[];
    institution_id: string | null;
  };
};

/**
 * Pure, server-only helper that validates a Bearer/Cookie JWT signature/expiry, verifies
 * active session existence in user_sessions when sessionId is bound, and loads
 * authoritative user identity, role, and institution_id from PostgreSQL.
 */
export async function authenticateBearerToken(
  token: string,
  db: DbClient,
  secret = getAuthSecret(),
  options: { requireSessionRecord?: boolean } = {},
): Promise<BearerAuthContext> {
  if (!token || typeof token !== "string") {
    throw new Error("Unauthorized: No token provided");
  }

  const check = verifySessionToken(token.trim(), secret);
  if (!check.valid || !check.payload || check.payload.scope === "totp_pending") {
    throw new Error(`Unauthorized: Invalid or expired session token (${check.reason ?? "invalid"})`);
  }

  const userId: string | null = check.payload.userId || check.payload.sub || null;
  if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("Unauthorized: Invalid user ID in token");
  }

  const sessionId: string | null =
    typeof check.payload.sessionId === "string" && check.payload.sessionId.trim().length > 0
      ? check.payload.sessionId.trim()
      : null;

  if (options.requireSessionRecord && !sessionId) {
    throw new Error("Unauthorized: Session binding missing");
  }

  const repo = authRepository(db);
  if (sessionId) {
    const activeSession = await repo.findActiveSession(sessionId, userId);
    if (!activeSession) {
      throw new Error("Unauthorized: Session revoked or expired");
    }
  }

  const [profile, roleRows] = await Promise.all([
    repo.findProfileById(userId),
    repo.getUserRoles(userId),
  ]);

  if (!profile) {
    throw new Error("Unauthorized: Account does not exist");
  }

  const sortedRoles = sortRoleRows(roleRows);
  const roles = sortedRoles.map((r: any) => String(r.role)).filter(Boolean);
  const primaryRoleRow = sortedRoles[0] as { role?: string; institution_id?: string | null } | undefined;
  const authoritativeRole = primaryRoleRow?.role ?? "student";
  const authoritativeInstitutionId =
    primaryRoleRow?.institution_id ?? profile.institution_id ?? null;

  return {
    supabase: db,
    userId: profile.id,
    sessionId,
    claims: {
      sub: profile.id,
      email: profile.email,
      role: authoritativeRole,
      roles: roles.length > 0 ? roles : [authoritativeRole],
      institution_id: authoritativeInstitutionId,
    },
  };
}
