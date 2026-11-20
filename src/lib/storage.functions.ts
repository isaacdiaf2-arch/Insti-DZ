import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  storageAdapter,
  sanitizeStoragePath,
  validateFilePayload,
  DEFAULT_MAX_FILE_SIZE,
} from "@/server/storage/storage.adapter";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const ALLOWED_STORAGE_BUCKETS = new Set([
  "payment-proofs",
  "institution-media",
  "lesson-materials",
  "homework-submissions",
]);

export function assertTenantStorageAccess(
  cleanPath: string,
  claims: { roles: string[]; institution_id: string | null },
) {
  if (claims.roles.includes("platform_admin")) return;
  if (!claims.institution_id || !cleanPath.startsWith(`${claims.institution_id}/`)) {
    throw new Error("غير مصرح: لا يمكنك الوصول إلى ملفات خارج مؤسستك.");
  }
}

export function assertStorageBucketAccess(
  bucket: string,
  operation: "upload" | "read",
  claims: { roles: string[]; institution_id: string | null },
  cleanPath: string,
) {
  if (!ALLOWED_STORAGE_BUCKETS.has(bucket)) {
    throw new Error("غير مصرح: حاوية التخزين المطلوبة غير مسموحة.");
  }
  assertTenantStorageAccess(cleanPath, claims);

  if (claims.roles.includes("platform_admin")) return;
  const isInstAdmin = claims.roles.includes("institution_admin");
  const isTeacher = claims.roles.includes("teacher");
  const isStudent = claims.roles.includes("student");

  if (bucket === "payment-proofs") {
    if (!isInstAdmin) {
      throw new Error("غير مصرح: الوصول إلى وصولات الدفع مخصص لمدير المؤسسة أو مدير المنصة فقط.");
    }
    return;
  }

  if (bucket === "institution-media" && operation === "upload" && !isInstAdmin) {
    throw new Error("غير مصرح: رفع ملفات هوية المؤسسة مخصص لمدير المؤسسة فقط.");
  }

  if (bucket === "lesson-materials" && operation === "upload" && !isInstAdmin && !isTeacher) {
    throw new Error("غير مصرح: رفع مواد الدروس مخصص للأساتذة والإدارة فقط.");
  }

  if (
    bucket === "homework-submissions" &&
    operation === "upload" &&
    !isStudent &&
    !isTeacher &&
    !isInstAdmin
  ) {
    throw new Error("غير مصرح: رفع الواجبات غير مسموح لهذا الدور.");
  }
}

export const uploadMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        bucket: z.string().min(1).max(64),
        path: z.string().min(1).max(255),
        fileBase64: z.string().min(1),
        contentType: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const cleanPath = sanitizeStoragePath(data.path);
    assertStorageBucketAccess(data.bucket, "upload", context.claims, cleanPath);

    const buffer = Buffer.from(data.fileBase64, "base64");
    validateFilePayload(buffer, data.contentType, DEFAULT_MAX_FILE_SIZE);

    const uploadResult = await storageAdapter.upload({
      bucket: data.bucket,
      path: cleanPath,
      data: buffer,
      contentType: data.contentType,
    });

    const signedUrl = storageAdapter.createSignedUrl(
      data.bucket,
      uploadResult.path,
      60 * 60 * 24 * 365 * 5,
    );

    return {
      path: uploadResult.path,
      url: signedUrl,
      size: uploadResult.size,
    };
  });

export const getSignedMediaUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        bucket: z.string().min(1).max(64),
        path: z.string().min(1).max(255),
        expiresInSeconds: z.number().int().positive().optional().default(3600),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const cleanPath = sanitizeStoragePath(data.path);
    assertStorageBucketAccess(data.bucket, "read", context.claims, cleanPath);

    const url = storageAdapter.createSignedUrl(data.bucket, cleanPath, data.expiresInSeconds);
    return { url };
  });
