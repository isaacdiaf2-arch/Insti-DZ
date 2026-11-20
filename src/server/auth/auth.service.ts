import { randomUUID } from "node:crypto";
import type { DbClient } from "@/server/db/adapter";
import { SESSION_TTL_SECONDS, sortRoleRows } from "@/lib/auth.shared";
import { authRepository } from "./auth.repository";
import {
  getAuthSecret,
  hashPassword,
  verifyPassword,
  signSessionToken,
  signTotpChallengeToken,
  verifySessionToken,
} from "./crypto";

export class AuthError extends Error {
  constructor(message: string, public statusCode = 401) {
    super(message);
    this.name = "AuthError";
  }
}

export type SessionClientMeta = {
  userAgent?: string | null;
  ipAddress?: string | null;
};

export function authService(db: DbClient, secret?: string) {
  const repo = authRepository(db);
  const resolveSecret = () => secret ?? getAuthSecret();

  async function createTrackedSessionToken(params: {
    userId: string;
    email: string;
    primaryRole: string;
    roles: string[];
    institutionId: string | null;
    meta?: SessionClientMeta;
  }) {
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
    await repo.createSession({
      id: sessionId,
      user_id: params.userId,
      institution_id: params.institutionId,
      roles: params.roles,
      expires_at: expiresAt,
      user_agent: params.meta?.userAgent ?? null,
      ip_address: params.meta?.ipAddress ?? null,
    });
    return signSessionToken(
      {
        userId: params.userId,
        email: params.email,
        role: params.primaryRole,
        institutionId: params.institutionId,
        sessionId,
      },
      resolveSecret(),
    );
  }

  return {
    async authenticateUser(email: string, passwordAttempt: string, meta?: SessionClientMeta) {
      if (!email || !passwordAttempt) {
        throw new AuthError("البريد الإلكتروني وكلمة المرور مطلوبان.", 400);
      }

      const profile = await repo.findAuthRecordByEmail(email);
      if (!profile || !profile.password_hash || !verifyPassword(passwordAttempt, profile.password_hash)) {
        if (profile) {
          await repo.logAuthEvent({
            actor_id: profile.id,
            institution_id: profile.institution_id,
            action: "login_failed",
            resource: "user_session",
            result: "denied",
          }).catch(() => {});
        }
        throw new AuthError("بيانات الدخول غير صحيحة.", 401);
      }

      if (profile.institution_id) {
        const inst = await repo.getInstitutionStatus(profile.institution_id);
        if (inst && inst.status === "suspended") {
          throw new AuthError("تم تجميد حساب هذه المؤسسة مؤقتاً، يرجى مراجعة إدارة المنصة.", 403);
        }
      }

      const rawRoles = await repo.getUserRoles(profile.id);
      const roles = sortRoleRows(rawRoles);
      const primaryRole = roles[0]?.role ?? "student";
      const roleNames = roles.map((r: any) => String(r.role)).filter(Boolean);
      const user = {
        id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        institutionId: profile.institution_id,
        roles: roleNames,
      };

      if (profile.totp_enabled) {
        const challengeToken = signTotpChallengeToken(
          { userId: profile.id, email: profile.email },
          resolveSecret(),
        );
        return {
          requiresTotp: true as const,
          challengeToken,
          token: null,
          user,
        };
      }

      const token = await createTrackedSessionToken({
        userId: profile.id,
        email: profile.email,
        primaryRole,
        roles: roleNames.length ? roleNames : [primaryRole],
        institutionId: profile.institution_id,
        meta,
      });

      await repo.logAuthEvent({
        actor_id: profile.id,
        institution_id: profile.institution_id,
        action: "login",
        resource: "user_session",
        result: "success",
      });

      return {
        requiresTotp: false as const,
        challengeToken: null,
        user,
        token,
      };
    },

    async issueSessionOrChallengeForUser(userId: string, meta?: SessionClientMeta) {
      const profile = await repo.findAuthRecordById(userId);
      if (!profile) {
        throw new AuthError("الحساب غير موجود.", 401);
      }
      if (profile.institution_id) {
        const inst = await repo.getInstitutionStatus(profile.institution_id);
        if (inst && inst.status === "suspended") {
          throw new AuthError("تم تجميد حساب هذه المؤسسة مؤقتاً، يرجى مراجعة إدارة المنصة.", 403);
        }
      }

      const rawRoles = await repo.getUserRoles(profile.id);
      const roles = sortRoleRows(rawRoles);
      const primaryRole = roles[0]?.role ?? "student";
      const roleNames = roles.map((r: any) => String(r.role)).filter(Boolean);
      const user = {
        id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        institutionId: profile.institution_id,
        roles: roleNames,
      };

      if (profile.totp_enabled) {
        const challengeToken = signTotpChallengeToken(
          { userId: profile.id, email: profile.email },
          resolveSecret(),
        );
        return {
          requiresTotp: true as const,
          challengeToken,
          token: null,
          user,
        };
      }

      const token = await createTrackedSessionToken({
        userId: profile.id,
        email: profile.email,
        primaryRole,
        roles: roleNames.length ? roleNames : [primaryRole],
        institutionId: profile.institution_id,
        meta,
      });

      await repo.logAuthEvent({
        actor_id: profile.id,
        institution_id: profile.institution_id,
        action: "login",
        resource: "user_session",
        result: "success",
        metadata: { via: "vault" },
      });

      return {
        requiresTotp: false as const,
        challengeToken: null,
        token,
        user,
      };
    },

    async issueSessionAfterTotp(userId: string, meta?: SessionClientMeta) {
      const profile = await repo.findAuthRecordById(userId);
      if (!profile) {
        throw new AuthError("الحساب غير موجود.", 401);
      }
      if (profile.institution_id) {
        const inst = await repo.getInstitutionStatus(profile.institution_id);
        if (inst && inst.status === "suspended") {
          throw new AuthError("تم تجميد حساب هذه المؤسسة مؤقتاً، يرجى مراجعة إدارة المنصة.", 403);
        }
      }

      const rawRoles = await repo.getUserRoles(profile.id);
      const roles = sortRoleRows(rawRoles);
      const primaryRole = roles[0]?.role ?? "student";
      const roleNames = roles.map((r: any) => String(r.role)).filter(Boolean);

      const token = await createTrackedSessionToken({
        userId: profile.id,
        email: profile.email,
        primaryRole,
        roles: roleNames.length ? roleNames : [primaryRole],
        institutionId: profile.institution_id,
        meta,
      });

      await repo.logAuthEvent({
        actor_id: profile.id,
        institution_id: profile.institution_id,
        action: "login",
        resource: "user_session",
        result: "success",
        metadata: { totp: true },
      });

      return {
        user: {
          id: profile.id,
          email: profile.email,
          firstName: (profile as any).first_name ?? "",
          lastName: (profile as any).last_name ?? "",
          institutionId: profile.institution_id,
          roles: roleNames,
        },
        token,
      };
    },

    async revokeSession(sessionId: string, userId?: string) {
      if (!sessionId) return;
      await repo.deleteSession(sessionId, userId);
    },

    async revokeAllUserSessions(userId: string) {
      if (!userId) return;
      await repo.deleteAllUserSessions(userId);
    },

    async verifyUserPasswordById(userId: string, passwordAttempt: string): Promise<boolean> {
      if (!userId || !passwordAttempt) return false;
      const record = await repo.findAuthRecordById(userId);
      if (!record || !record.password_hash) return false;
      return verifyPassword(passwordAttempt, record.password_hash);
    },

    async verifySessionToken(token: string) {
      const res = verifySessionToken(token, resolveSecret());
      if (!res.valid || !res.payload) {
        throw new AuthError("جلسة غير صالحة أو منتهية الصلاحية.", 401);
      }
      return res.payload;
    },

    async registerUser(params: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      role: "student" | "teacher" | "institution_admin";
      institutionId?: string | null;
      meta?: SessionClientMeta;
    }) {
      if (!params.password || params.password.length < 8) {
        throw new AuthError("كلمة المرور يجب أن تكون 8 أحرف على الأقل.", 400);
      }

      const existing = await repo.findProfileByEmail(params.email);
      if (existing) {
        throw new AuthError("هذا البريد الإلكتروني مسجل بالفعل.", 400);
      }

      const passwordHash = hashPassword(params.password);

      const profile = await repo.createProfile({
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        institution_id: params.institutionId ?? null,
        password_hash: passwordHash,
      });

      await repo.assignRole(profile.id, params.role, params.institutionId);

      await repo.logAuthEvent({
        actor_id: profile.id,
        institution_id: params.institutionId ?? null,
        action: "register",
        resource: "user_profile",
        result: "success",
        metadata: { role: params.role },
      });

      const token = await createTrackedSessionToken({
        userId: profile.id,
        email: profile.email,
        primaryRole: params.role,
        roles: [params.role],
        institutionId: params.institutionId ?? null,
        meta: params.meta,
      });

      return { profile, token };
    },

    async changePassword(userId: string, currentPassword: string, newPassword: string) {
      if (!currentPassword || !newPassword || newPassword.length < 8) {
        throw new AuthError("كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.", 400);
      }

      const record = await repo.findAuthRecordById(userId);
      if (!record || !record.password_hash || !verifyPassword(currentPassword, record.password_hash)) {
        throw new AuthError("كلمة المرور الحالية غير صحيحة.", 401);
      }

      const nextHash = hashPassword(newPassword);
      await repo.updatePasswordHash(userId, nextHash);
      await repo.deleteAllUserSessions(userId);

      await repo.logAuthEvent({
        actor_id: userId,
        institution_id: record.institution_id,
        action: "password_changed",
        resource: "user_profile",
        result: "success",
      });

      return { ok: true as const };
    },

    async setPasswordByAdmin(userId: string, newPassword: string, actorId?: string) {
      if (!userId || !newPassword || newPassword.length < 8) {
        throw new AuthError("كلمة المرور يجب أن تكون 8 أحرف على الأقل.", 400);
      }
      const targetProfile = await repo.findProfileById(userId);
      const nextHash = hashPassword(newPassword);
      await repo.updatePasswordHash(userId, nextHash);
      await repo.deleteAllUserSessions(userId);
      await repo
        .logAuthEvent({
          actor_id: actorId ?? null,
          institution_id: targetProfile?.institution_id ?? null,
          action: "password_reset_resolved",
          resource: "user_profile",
          result: "success",
          metadata: { target_user_id: userId },
        })
        .catch(() => {});
      return { ok: true as const };
    },

    hashUserPassword(password: string) {
      return hashPassword(password);
    },

    verifyUserPassword(password: string, hash: string) {
      return verifyPassword(password, hash);
    },
  };
}
