import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { storageAdapter, sanitizeStoragePath, validateFilePayload, DEFAULT_MAX_FILE_SIZE } from "@/server/storage/storage.adapter";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const uploadMedia = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        bucket: z.string().min(1).max(64),
        path: z.string().min(1).max(255),
        fileBase64: z.string().min(1),
        contentType: z.string().min(1),
      })
      .parse(input)
  )
  .handler(async ({ data }) => {
    const cleanPath = sanitizeStoragePath(data.path);
    const buffer = Buffer.from(data.fileBase64, "base64");
    validateFilePayload(buffer, data.contentType, DEFAULT_MAX_FILE_SIZE);

    const uploadResult = await storageAdapter.upload({
      bucket: data.bucket,
      path: cleanPath,
      data: buffer,
      contentType: data.contentType,
    });

    // Generate signed URL valid for 5 years for uploaded assets (matching platform requirements)
    const signedUrl = storageAdapter.createSignedUrl(data.bucket, uploadResult.path, 60 * 60 * 24 * 365 * 5);

    return {
      path: uploadResult.path,
      url: signedUrl,
      size: uploadResult.size,
    };
  });

export const getSignedMediaUrl = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        bucket: z.string().min(1).max(64),
        path: z.string().min(1).max(255),
        expiresInSeconds: z.number().int().positive().optional().default(3600),
      })
      .parse(input)
  )
  .handler(async ({ data }) => {
    const cleanPath = sanitizeStoragePath(data.path);
    const url = storageAdapter.createSignedUrl(data.bucket, cleanPath, data.expiresInSeconds);
    return { url };
  });
