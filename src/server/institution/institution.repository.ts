import type { DbClient } from "@/server/db/adapter";

export function institutionRepository(db: DbClient) {
  return {
    async findById(id: string) {
      const { data, error } = await db
        .from("institutions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`Database error fetching institution: ${error.message}`);
      return data;
    },

    async listAll() {
      const { data, error } = await db
        .from("institutions")
        .select("id, name, slug, email, phone, status, subscription_end, created_at")
        .order("created_at", { ascending: false });
      if (error) throw new Error(`Database error listing institutions: ${error.message}`);
      return data ?? [];
    },

    async update(id: string, updates: Partial<{ name: string; phone: string; address: string; logo_url: string; cover_url: string }>) {
      const { data, error } = await db
        .from("institutions")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(`Database error updating institution: ${error.message}`);
      return data;
    },

    async getStats(institutionId: string) {
      const [studentsRes, teachersRes, groupsRes] = await Promise.all([
        db.from("user_roles").select("user_id", { count: "exact", head: true }).eq("institution_id", institutionId).eq("role", "student"),
        db.from("user_roles").select("user_id", { count: "exact", head: true }).eq("institution_id", institutionId).eq("role", "teacher"),
        db.from("groups").select("id", { count: "exact", head: true }).eq("institution_id", institutionId),
      ]);
      return {
        studentsCount: studentsRes.count ?? 0,
        teachersCount: teachersRes.count ?? 0,
        groupsCount: groupsRes.count ?? 0,
      };
    },
  };
}
