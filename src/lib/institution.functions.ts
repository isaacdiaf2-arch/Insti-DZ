import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getInstitutionDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ institutionId: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    if (!context.claims.role) {
      throw new Error("غير مصرح: لا يوجد دور صالح للمستخدم.");
    }
    const { getServiceDb } = await import("@/server/db/adapter");
    const { institutionService } = await import("@/server/institution/institution.service");
    const db = await getServiceDb();
    const service = institutionService(db);

    return service.getInstitutionDetails(data.institutionId, {
      id: context.userId,
      role: context.claims.role,
      institutionId: context.claims.institution_id,
    });
  });

export const updateInstitutionProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        institutionId: z.string().uuid(),
        name: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        logoUrl: z.string().optional(),
        coverUrl: z.string().optional(),
        primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    if (!context.claims.role) {
      throw new Error("غير مصرح: لا يوجد دور صالح للمستخدم.");
    }
    const { getServiceDb } = await import("@/server/db/adapter");
    const { institutionService } = await import("@/server/institution/institution.service");
    const db = await getServiceDb();
    const service = institutionService(db);

    return service.updateInstitutionSettings(data.institutionId, data, {
      role: context.claims.role,
      institutionId: context.claims.institution_id,
    });
  });

export const listInstitutionsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!context.claims.role) {
      throw new Error("غير مصرح: لا يوجد دور صالح للمستخدم.");
    }
    const { getServiceDb } = await import("@/server/db/adapter");
    const { institutionService } = await import("@/server/institution/institution.service");
    const db = await getServiceDb();
    const service = institutionService(db);

    return service.listInstitutionsForPlatformAdmin({
      role: context.claims.role,
    });
  });
