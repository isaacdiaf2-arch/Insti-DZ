import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getInstitutionDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ institutionId: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const { institutionService } = await import("@/server/institution/institution.service");
    const db = await getServiceDb();
    const service = institutionService(db);

    return service.getInstitutionDetails(data.institutionId, {
      id: context.userId,
      role: context.claims.role ?? "institution_admin",
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
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const { institutionService } = await import("@/server/institution/institution.service");
    const db = await getServiceDb();
    const service = institutionService(db);

    return service.updateInstitutionSettings(data.institutionId, data, {
      role: context.claims.role ?? "institution_admin",
      institutionId: context.claims.institution_id,
    });
  });

export const listInstitutionsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const { institutionService } = await import("@/server/institution/institution.service");
    const db = await getServiceDb();
    const service = institutionService(db);

    return service.listInstitutionsForPlatformAdmin({
      role: context.claims.role ?? "platform_admin",
    });
  });
