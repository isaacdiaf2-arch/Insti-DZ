import type { DbClient } from "@/server/db/adapter";

export function authRepository(db: DbClient) {
  return {
    async findProfileByEmail(email: string) {
      const { data, error } = await db
        .from("profiles")
        .select("id, email, first_name, last_name, avatar_url, institution_id, created_at, updated_at")
        .ilike("email", email.trim().toLowerCase())
        .maybeSingle();
      if (error) throw new Error(`Database error querying profile: ${error.message}`);
      return data;
    },

    async findProfileById(userId: string) {
      const { data, error } = await db
        .from("profiles")
        .select("id, email, first_name, last_name, avatar_url, institution_id, created_at, updated_at")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(`Database error querying profile: ${error.message}`);
      return data;
    },

    async getUserRoles(userId: string) {
      const { data, error } = await db
        .from("user_roles")
        .select("role, institution_id")
        .eq("user_id", userId);
      if (error) throw new Error(`Database error querying user roles: ${error.message}`);
      return data ?? [];
    },

    async getInstitutionStatus(institutionId: string) {
      const { data, error } = await db
        .from("institutions")
        .select("id, name, status, subscription_end")
        .eq("id", institutionId)
        .maybeSingle();
      if (error) throw new Error(`Database error querying institution: ${error.message}`);
      return data;
    },

    async createProfile(row: { id?: string; email: string; first_name: string; last_name: string; institution_id?: string | null }) {
      const { data, error } = await db
        .from("profiles")
        .insert({
          email: row.email.toLowerCase().trim(),
          first_name: row.first_name,
          last_name: row.last_name,
          institution_id: row.institution_id ?? null,
          ...(row.id ? { id: row.id } : {}),
        })
        .select("id, email, first_name, last_name, institution_id")
        .single();
      if (error) throw new Error(`Failed to create profile: ${error.message}`);
      return data;
    },

    async assignRole(userId: string, role: string, institutionId?: string | null) {
      const { error } = await db
        .from("user_roles")
        .upsert(
          { user_id: userId, role, institution_id: institutionId ?? null },
          { onConflict: "user_id,role" }
        );
      if (error) throw new Error(`Failed to assign role: ${error.message}`);
    },

    async logAuthEvent(row: { actor_id?: string | null; institution_id?: string | null; action: string; resource: string; result: string; metadata?: any }) {
      await db.from("audit_logs").insert({
        actor_id: row.actor_id ?? null,
        institution_id: row.institution_id ?? null,
        action: row.action,
        resource: row.resource,
        result: row.result,
        metadata: row.metadata ?? {},
      });
    },
  };
}
