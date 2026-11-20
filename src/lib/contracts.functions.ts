import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LEGACY_WORKFLOW_DISABLED_ERROR =
  "تم إيقاف مسار العقود القديم؛ يجب استخدام مسار العقود الرسمي المعتمد (official-contract) المزود بالتحقق الثنائي وحفظ النسخة الموثقة بـ SHA-256.";

/**
 * Legacy contract endpoints retained strictly as disabled tombstones to prevent bypassing
 * the immutable official_contracts + contract_artifacts + password re-auth signing workflow.
 */
export const createContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ agreed: z.literal(true), commercialRegister: z.string().max(60).optional() }).parse(data),
  )
  .handler(async () => {
    throw new Error(LEGACY_WORKFLOW_DISABLED_ERROR);
  });

export const signContractAsInstitution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        contractId: z.string().uuid(),
        signature: z.string().startsWith("data:image/png;base64,").max(2_000_000),
      })
      .parse(data),
  )
  .handler(async () => {
    throw new Error(LEGACY_WORKFLOW_DISABLED_ERROR);
  });

export const signContractAsPlatform = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        contractId: z.string().uuid(),
        signature: z.string().startsWith("data:image/png;base64,").max(2_000_000),
      })
      .parse(data),
  )
  .handler(async () => {
    throw new Error(LEGACY_WORKFLOW_DISABLED_ERROR);
  });

export const setContractStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        contractId: z.string().uuid(),
        status: z.enum(["renewed", "expired", "cancelled"]),
      })
      .parse(data),
  )
  .handler(async () => {
    throw new Error(LEGACY_WORKFLOW_DISABLED_ERROR);
  });
