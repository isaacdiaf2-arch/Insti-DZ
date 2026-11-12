import type { DbClient } from "@/server/db/adapter";
import { authRepository } from "./auth.repository";
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken } from "./crypto";

const DEFAULT_AUTH_SECRET = process.env.AUTH_SECRET || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "studydz-secure-session-signing-key-production-secret-2026";

export class AuthError extends Error {
  constructor(message: string, public statusCode = 401) {
    super(message);
    this.name = "AuthError";
  }
}

export function authService(db: DbClient, secret = DEFAULT_AUTH_SECRET) {
  const repo = authRepository(db);

  return {
    async authenticateUser(email: string, passwordAttempt: string) {
      if (!email || !passwordAttempt) {
        throw new AuthError("البريد الإلكتروني وكلمة المرور مطلوبان.", 400);
      }

      const profile = await repo.findProfileByEmail(email);
      if (!profile) {
        throw new AuthError("بيانات الدخول غير صحيحة.", 401);
      }

      // Check institution status if user belongs to an institution
      if (profile.institution_id) {
        const inst = await repo.getInstitutionStatus(profile.institution_id);
        if (inst && inst.status === "suspended") {
          throw new AuthError("تم تجميد حساب هذه المؤسسة مؤقتاً، يرجى مراجعة إدارة المنصة.", 403);
        }
      }

      const roles = await repo.getUserRoles(profile.id);
      const primaryRole = roles[0]?.role ?? "student";

      const token = signSessionToken(
        {
          userId: profile.id,
          email: profile.email,
          role: primaryRole,
          institutionId: profile.institution_id,
        },
        secret
      );

      await repo.logAuthEvent({
        actor_id: profile.id,
        institution_id: profile.institution_id,
        action: "login",
        resource: "user_session",
        result: "success",
      });

      return {
        user: {
          id: profile.id,
          email: profile.email,
          firstName: profile.first_name,
          lastName: profile.last_name,
          institutionId: profile.institution_id,
          roles: roles.map((r: any) => r.role),
        },
        token,
      };
    },

    async verifySessionToken(token: string) {
      const res = verifySessionToken(token, secret);
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
    }) {
      const existing = await repo.findProfileByEmail(params.email);
      if (existing) {
        throw new AuthError("هذا البريد الإلكتروني مسجل بالفعل.", 400);
      }

      const profile = await repo.createProfile({
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        institution_id: params.institutionId ?? null,
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

      const token = signSessionToken(
        {
          userId: profile.id,
          email: profile.email,
          role: params.role,
          institutionId: params.institutionId ?? null,
        },
        secret
      );

      return { profile, token };
    },

    hashUserPassword(password: string) {
      return hashPassword(password);
    },

    verifyUserPassword(password: string, hash: string) {
      return verifyPassword(password, hash);
    },
  };
}
