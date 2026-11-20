import type { DbClient } from "@/server/db/adapter";
import { institutionRepository } from "./institution.repository";

export class InstitutionAccessError extends Error {
  constructor(message: string, public statusCode = 403) {
    super(message);
    this.name = "InstitutionAccessError";
  }
}

export function institutionService(db: DbClient) {
  const repo = institutionRepository(db);

  return {
    async getInstitutionDetails(institutionId: string, caller: { id: string; role: string; institutionId?: string | null }) {
      if (caller.role !== "platform_admin" && caller.institutionId !== institutionId) {
        throw new InstitutionAccessError("غير مصرح: لا يمكنك الوصول إلى بيانات مؤسسة أخرى.");
      }

      const inst = await repo.findById(institutionId);
      if (!inst) {
        throw new InstitutionAccessError("المؤسسة غير موجودة.", 404);
      }

      const stats = await repo.getStats(institutionId);
      return { ...inst, stats };
    },

    async listInstitutionsForPlatformAdmin(caller: { role: string }) {
      if (caller.role !== "platform_admin") {
        throw new InstitutionAccessError("غير مصرح: هذه العملية مخصصة لمدير المنصة فقط.");
      }
      return repo.listAll();
    },

    async updateInstitutionSettings(
      institutionId: string,
      updates: { name?: string; phone?: string; address?: string; logoUrl?: string; coverUrl?: string; primaryColor?: string },
      caller: { role: string; institutionId?: string | null }
    ) {
      if (caller.role !== "platform_admin" && (caller.role !== "institution_admin" || caller.institutionId !== institutionId)) {
        throw new InstitutionAccessError("غير مصرح: ليس لديك صلاحية تعديل بيانات هذه المؤسسة.");
      }

      const payload: any = {};
      if (updates.name) payload.name = updates.name.trim();
      if (updates.phone) payload.phone = updates.phone.trim();
      if (updates.address) payload.address = updates.address.trim();
      if (updates.logoUrl) payload.logo_url = updates.logoUrl.trim();
      if (updates.coverUrl) payload.cover_url = updates.coverUrl.trim();
      if (updates.primaryColor) payload.primary_color = updates.primaryColor.trim();

      return repo.update(institutionId, payload);
    },
  };
}
