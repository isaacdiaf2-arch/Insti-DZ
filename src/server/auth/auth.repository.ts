import { and, eq, gt, ilike } from "drizzle-orm";
import type { DbClient } from "@/server/db/adapter";
import { institutions, profiles, userRoles, auditLogs, userSessions } from "../../../drizzle/schema";

export function authRepository(db: DbClient) {
  const drizzleDb = db?.drizzle;

  return {
    async findProfileByEmail(email: string) {
      const normalized = email.trim().toLowerCase();
      if (drizzleDb) {
        const [row] = await drizzleDb
          .select({
            id: profiles.id,
            email: profiles.email,
            first_name: profiles.firstName,
            last_name: profiles.lastName,
            avatar_url: profiles.avatarUrl,
            institution_id: profiles.institutionId,
            created_at: profiles.createdAt,
          })
          .from(profiles)
          .where(ilike(profiles.email, normalized))
          .limit(1);
        return row ?? null;
      }

      const { data, error } = await db
        .from("profiles")
        .select("id, email, first_name, last_name, avatar_url, institution_id, created_at")
        .ilike("email", normalized)
        .maybeSingle();
      if (error) throw new Error(`Database error querying profile: ${error.message}`);
      return data;
    },

    async findAuthRecordByEmail(email: string) {
      const normalized = email.trim().toLowerCase();
      if (drizzleDb) {
        const { data, error } = await db.rpc("auth_lookup_by_email", { _email: normalized });
        if (error) throw new Error(`Database error querying auth record: ${error.message}`);
        return data ?? null;
      }

      const { data, error } = await db
        .from("profiles")
        .select("id, email, first_name, last_name, institution_id, password_hash, totp_enabled")
        .ilike("email", normalized)
        .maybeSingle();
      if (error) throw new Error(`Database error querying auth record: ${error.message}`);
      return data;
    },

    async findAuthRecordById(userId: string) {
      if (drizzleDb) {
        const { data, error } = await db.rpc("auth_lookup_by_id", { _user_id: userId });
        if (error) throw new Error(`Database error querying auth record: ${error.message}`);
        return data ?? null;
      }

      const { data, error } = await db
        .from("profiles")
        .select("id, email, first_name, last_name, institution_id, password_hash, totp_enabled")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(`Database error querying auth record: ${error.message}`);
      return data;
    },

    async findProfileById(userId: string) {
      if (drizzleDb) {
        const [row] = await drizzleDb
          .select({
            id: profiles.id,
            email: profiles.email,
            first_name: profiles.firstName,
            last_name: profiles.lastName,
            avatar_url: profiles.avatarUrl,
            institution_id: profiles.institutionId,
            created_at: profiles.createdAt,
          })
          .from(profiles)
          .where(eq(profiles.id, userId))
          .limit(1);
        return row ?? null;
      }

      const { data, error } = await db
        .from("profiles")
        .select("id, email, first_name, last_name, avatar_url, institution_id, created_at")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(`Database error querying profile: ${error.message}`);
      return data;
    },

    async getUserRoles(userId: string) {
      if (drizzleDb) {
        const rows = await drizzleDb
          .select({
            role: userRoles.role,
            institution_id: userRoles.institutionId,
          })
          .from(userRoles)
          .where(eq(userRoles.userId, userId));
        return rows;
      }

      const { data, error } = await db
        .from("user_roles")
        .select("role, institution_id")
        .eq("user_id", userId);
      if (error) throw new Error(`Database error querying user roles: ${error.message}`);
      return data ?? [];
    },

    async getInstitutionStatus(institutionId: string) {
      if (drizzleDb) {
        const [row] = await drizzleDb
          .select({
            id: institutions.id,
            name: institutions.name,
            status: institutions.status,
            subscription_end: institutions.subscriptionEnd,
          })
          .from(institutions)
          .where(eq(institutions.id, institutionId))
          .limit(1);
        return row ?? null;
      }

      const { data, error } = await db
        .from("institutions")
        .select("id, name, status, subscription_end")
        .eq("id", institutionId)
        .maybeSingle();
      if (error) throw new Error(`Database error querying institution: ${error.message}`);
      return data;
    },

    async createProfile(row: {
      id?: string;
      email: string;
      first_name: string;
      last_name: string;
      institution_id?: string | null;
      password_hash?: string | null;
    }) {
      if (drizzleDb) {
        const [created] = await drizzleDb
          .insert(profiles)
          .values({
            ...(row.id ? { id: row.id } : {}),
            email: row.email.toLowerCase().trim(),
            firstName: row.first_name,
            lastName: row.last_name,
            institutionId: row.institution_id ?? null,
            totpEnabled: false,
          })
          .returning({
            id: profiles.id,
            email: profiles.email,
            first_name: profiles.firstName,
            last_name: profiles.lastName,
            institution_id: profiles.institutionId,
          });
        if (!created) throw new Error("Failed to create profile.");
        if (row.password_hash) {
          const { error: pwErr } = await db.rpc("auth_update_password_hash", {
            _user_id: created.id,
            _password_hash: row.password_hash,
          });
          if (pwErr) throw new Error(`Failed to set profile password: ${pwErr.message}`);
        }
        return created;
      }

      const { data, error } = await db
        .from("profiles")
        .insert({
          email: row.email.toLowerCase().trim(),
          first_name: row.first_name,
          last_name: row.last_name,
          institution_id: row.institution_id ?? null,
          ...(row.password_hash ? { password_hash: row.password_hash } : {}),
          ...(row.id ? { id: row.id } : {}),
        })
        .select("id, email, first_name, last_name, institution_id")
        .single();
      if (error) throw new Error(`Failed to create profile: ${error.message}`);
      return data;
    },

    async updatePasswordHash(userId: string, passwordHash: string) {
      if (drizzleDb) {
        const { data, error } = await db.rpc("auth_update_password_hash", {
          _user_id: userId,
          _password_hash: passwordHash,
        });
        if (error || !data) throw new Error("تعذّر تحديث كلمة المرور.");
        return { id: String(data) };
      }

      const { data, error } = await db
        .from("profiles")
        .update({ password_hash: passwordHash })
        .eq("id", userId)
        .select("id")
        .single();
      if (error) throw new Error(`Failed to update password: ${error.message}`);
      return data;
    },

    async assignRole(userId: string, role: string, institutionId?: string | null) {
      if (drizzleDb) {
        await drizzleDb
          .insert(userRoles)
          .values({
            userId,
            role: role as typeof userRoles.$inferInsert.role,
            institutionId: institutionId ?? null,
          })
          .onConflictDoUpdate({
            target: [userRoles.userId, userRoles.role],
            set: { institutionId: institutionId ?? null },
          });
        return;
      }

      const { error } = await db
        .from("user_roles")
        .upsert(
          { user_id: userId, role, institution_id: institutionId ?? null },
          { onConflict: "user_id,role" },
        );
      if (error) throw new Error(`Failed to assign role: ${error.message}`);
    },

    async logAuthEvent(row: {
      actor_id?: string | null;
      institution_id?: string | null;
      action: string;
      resource: string;
      result: string;
      metadata?: any;
    }) {
      if (drizzleDb) {
        await drizzleDb.insert(auditLogs).values({
          actorId: row.actor_id ?? null,
          institutionId: row.institution_id ?? null,
          action: row.action,
          resource: row.resource,
          result: row.result,
          metadata: row.metadata ?? {},
        });
        return;
      }

      const { error } = await db.from("audit_logs").insert({
        actor_id: row.actor_id ?? null,
        institution_id: row.institution_id ?? null,
        action: row.action,
        resource: row.resource,
        result: row.result,
        metadata: row.metadata ?? {},
      });
      if (error) throw new Error(`Failed to log auth event: ${error.message}`);
    },

    async createSession(row: {
      id: string;
      user_id: string;
      institution_id: string | null;
      roles: string[];
      expires_at: string;
      user_agent?: string | null;
      ip_address?: string | null;
    }) {
      if (drizzleDb) {
        await drizzleDb.insert(userSessions).values({
          id: row.id,
          userId: row.user_id,
          institutionId: row.institution_id,
          roles: row.roles,
          expiresAt: new Date(row.expires_at),
          lastActiveAt: new Date(),
          userAgent: row.user_agent ?? null,
          ipAddress: row.ip_address ?? null,
        });
        return;
      }

      const { error } = await db.from("user_sessions").insert({
        id: row.id,
        user_id: row.user_id,
        institution_id: row.institution_id,
        roles: row.roles,
        expires_at: row.expires_at,
        last_active_at: new Date().toISOString(),
        user_agent: row.user_agent ?? null,
        ip_address: row.ip_address ?? null,
      });
      if (error) throw new Error(`Failed to persist session: ${error.message}`);
    },

    async findActiveSession(sessionId: string, userId: string) {
      const now = new Date();
      if (drizzleDb) {
        const [row] = await drizzleDb
          .select({
            id: userSessions.id,
            user_id: userSessions.userId,
            expires_at: userSessions.expiresAt,
          })
          .from(userSessions)
          .where(
            and(
              eq(userSessions.id, sessionId),
              eq(userSessions.userId, userId),
              gt(userSessions.expiresAt, now),
            ),
          )
          .limit(1);
        return row ?? null;
      }

      const { data, error } = await db
        .from("user_sessions")
        .select("id, user_id, expires_at")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`Database error querying session: ${error.message}`);
      if (!data) return null;
      if (data.expires_at && new Date(data.expires_at).getTime() <= now.getTime()) {
        return null;
      }
      return data;
    },

    async deleteSession(sessionId: string, userId?: string) {
      if (drizzleDb) {
        await drizzleDb
          .delete(userSessions)
          .where(
            userId
              ? and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId))
              : eq(userSessions.id, sessionId),
          );
        return;
      }

      let q = db.from("user_sessions").delete().eq("id", sessionId);
      if (userId) q = q.eq("user_id", userId);
      await q;
    },

    async deleteAllUserSessions(userId: string) {
      if (drizzleDb) {
        await drizzleDb.delete(userSessions).where(eq(userSessions.userId, userId));
        return;
      }
      await db.from("user_sessions").delete().eq("user_id", userId);
    },
  };
}
