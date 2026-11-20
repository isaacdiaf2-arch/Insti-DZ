import { and, count, desc, eq } from "drizzle-orm";
import type { DbClient } from "@/server/db/adapter";
import { groups, institutions, userRoles } from "../../../drizzle/schema";

export function institutionRepository(db: DbClient) {
  const drizzleDb = db?.drizzle;

  return {
    async findById(id: string) {
      if (drizzleDb) {
        const [row] = await drizzleDb
          .select({
            id: institutions.id,
            name: institutions.name,
            name_fr: institutions.nameFr,
            type: institutions.type,
            wilaya: institutions.wilaya,
            commune: institutions.commune,
            daira: institutions.daira,
            address: institutions.address,
            phone: institutions.phone,
            email: institutions.email,
            website: institutions.website,
            logo_url: institutions.logoUrl,
            cover_url: institutions.coverUrl,
            status: institutions.status,
            is_trial: institutions.isTrial,
            subscription_end: institutions.subscriptionEnd,
            trial_ends_at: institutions.trialEndsAt,
            owner_id: institutions.ownerId,
            created_at: institutions.createdAt,
          })
          .from(institutions)
          .where(eq(institutions.id, id))
          .limit(1);
        return row ?? null;
      }

      const { data, error } = await db
        .from("institutions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`Database error fetching institution: ${error.message}`);
      return data;
    },

    async listAll() {
      if (drizzleDb) {
        const rows = await drizzleDb
          .select({
            id: institutions.id,
            name: institutions.name,
            name_fr: institutions.nameFr,
            email: institutions.email,
            phone: institutions.phone,
            status: institutions.status,
            subscription_end: institutions.subscriptionEnd,
            created_at: institutions.createdAt,
          })
          .from(institutions)
          .orderBy(desc(institutions.createdAt));
        return rows;
      }

      const { data, error } = await db
        .from("institutions")
        .select("id, name, name_fr, email, phone, status, subscription_end, created_at")
        .order("created_at", { ascending: false });
      if (error) throw new Error(`Database error listing institutions: ${error.message}`);
      return data ?? [];
    },

    async update(
      id: string,
      updates: Partial<{ name: string; phone: string; address: string; logo_url: string; cover_url: string }>,
    ) {
      if (drizzleDb) {
        const patch: Partial<typeof institutions.$inferInsert> = {};
        if (updates.name !== undefined) patch.name = updates.name;
        if (updates.phone !== undefined) patch.phone = updates.phone;
        if (updates.address !== undefined) patch.address = updates.address;
        if (updates.logo_url !== undefined) patch.logoUrl = updates.logo_url;
        if (updates.cover_url !== undefined) patch.coverUrl = updates.cover_url;

        const [updated] = await drizzleDb
          .update(institutions)
          .set(patch)
          .where(eq(institutions.id, id))
          .returning();
        if (!updated) throw new Error("Institution not found.");
        return updated;
      }

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
      if (drizzleDb) {
        const [[studentsRow], [teachersRow], [groupsRow]] = await Promise.all([
          drizzleDb
            .select({ count: count() })
            .from(userRoles)
            .where(and(eq(userRoles.institutionId, institutionId), eq(userRoles.role, "student"))),
          drizzleDb
            .select({ count: count() })
            .from(userRoles)
            .where(and(eq(userRoles.institutionId, institutionId), eq(userRoles.role, "teacher"))),
          drizzleDb
            .select({ count: count() })
            .from(groups)
            .where(eq(groups.institutionId, institutionId)),
        ]);

        return {
          studentsCount: Number(studentsRow?.count ?? 0),
          teachersCount: Number(teachersRow?.count ?? 0),
          groupsCount: Number(groupsRow?.count ?? 0),
        };
      }

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
