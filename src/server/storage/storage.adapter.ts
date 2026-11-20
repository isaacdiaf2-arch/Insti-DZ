import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAuthSecret } from "@/server/auth/crypto";

export interface StorageUploadOptions {
  bucket: string;
  path: string;
  data: Uint8Array | Buffer;
  contentType: string;
  sizeLimitBytes?: number;
}

export interface StorageFileMetadata {
  bucket: string;
  path: string;
  size: number;
  contentType: string;
  createdAt: string;
  url?: string;
}

export interface StorageReadResult {
  data: Buffer;
  contentType: string;
}

export const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export const DEFAULT_MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function getStorageSigningSecret(): string {
  const configured = process.env.STORAGE_SIGNING_SECRET?.trim();
  if (configured && configured.length >= 32) {
    return configured;
  }
  return getAuthSecret();
}

function getLocalStorageRoot(): string {
  return path.resolve(process.env.LOCAL_STORAGE_DIR?.trim() || path.resolve(process.cwd(), ".studydz-storage"));
}

/**
 * Validates bucket name against traversal or invalid characters.
 */
export function sanitizeBucketName(bucket: string): string {
  if (!bucket || typeof bucket !== "string") {
    throw new Error("اسم حاوية التخزين غير صالح.");
  }
  const clean = bucket.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(clean)) {
    throw new Error("اسم حاوية التخزين يحتوي على محارف غير آمنة.");
  }
  return clean;
}

/**
 * Validates file path against directory traversal and dangerous characters.
 */
export function sanitizeStoragePath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error("مسار الملف غير صالح.");
  }
  const normalized = rawPath.replace(/\\/g, "/").trim();
  const hasControlChars = Array.from(normalized).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
  if (normalized.includes("..") || normalized.startsWith("/") || hasControlChars || normalized.includes("//")) {
    throw new Error("مسار الملف يحتوي على محارف غير آمنة.");
  }
  const cleanSegments = normalized.split("/").filter(Boolean);
  if (cleanSegments.length === 0 || cleanSegments.some((s) => s === "." || s === "..")) {
    throw new Error("مسار الملف غير صالح.");
  }
  return cleanSegments.join("/");
}

/**
 * Validates file content type and size limits.
 */
export function validateFilePayload(data: Uint8Array | Buffer, contentType: string, maxSize = DEFAULT_MAX_FILE_SIZE) {
  if (!data || data.length === 0) {
    throw new Error("الملف فارغ أو غير موجود.");
  }
  if (data.length > maxSize) {
    throw new Error(`حجم الملف يتجاوز الحد الأقصى المسموح (${Math.round(maxSize / (1024 * 1024))} ميغابايت).`);
  }
  if (!ALLOWED_MIME_TYPES.has(contentType.toLowerCase().trim())) {
    throw new Error(`نوع الملف غير مدعوم: ${contentType}. الأنواع المدعومة هي الصور وملفات PDF والمستندات.`);
  }
}

function inferMimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

function resolveLocalPaths(bucket: string, cleanPath: string): { filePath: string; metaPath: string } {
  const root = getLocalStorageRoot();
  const bucketDir = path.resolve(root, bucket);
  const filePath = path.resolve(bucketDir, cleanPath);
  if (filePath !== bucketDir && !filePath.startsWith(bucketDir + path.sep)) {
    throw new Error("مسار الملف يحتوي على محارف غير آمنة.");
  }

  const metaBucketDir = path.resolve(root, ".meta", bucket);
  const metaPath = path.resolve(metaBucketDir, `${cleanPath}.json`);
  if (metaPath !== metaBucketDir && !metaPath.startsWith(metaBucketDir + path.sep)) {
    throw new Error("مسار الملف يحتوي على محارف غير آمنة.");
  }

  return { filePath, metaPath };
}

function encodeS3UriPath(bucket: string, cleanPath: string): string {
  const segments = [bucket, ...cleanPath.split("/").filter(Boolean)].map((s) => encodeURIComponent(s));
  return "/" + segments.join("/");
}

function signS3Request(params: {
  method: "PUT" | "GET";
  url: URL;
  region: string;
  accessKey: string;
  secretKey: string;
  payload: Buffer;
  contentType?: string;
}): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(params.payload).digest("hex");

  const headerEntries: Array<[string, string]> = [
    ["host", params.url.host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", amzDate],
  ];
  if (params.contentType) {
    headerEntries.push(["content-type", params.contentType]);
  }
  headerEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = headerEntries.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = headerEntries.map(([k]) => k).join(";");

  const canonicalRequest = [
    params.method,
    params.url.pathname,
    params.url.search ? params.url.search.slice(1) : "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
  const kDate = hmac(`AWS4${params.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, params.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const headers: Record<string, string> = {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (params.contentType) {
    headers["Content-Type"] = params.contentType;
  }
  return headers;
}

/**
 * S3-compatible / Persistent Local Disk Storage Adapter for Study DZ.
 * Uses S3 (via AWS SigV4) when S3_ENDPOINT + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY are set,
 * otherwise stores binary payloads + metadata securely on disk under LOCAL_STORAGE_DIR / .studydz-storage.
 */
export class StorageAdapter {
  private getS3Config() {
    const endpoint = (process.env.S3_ENDPOINT || process.env.STORAGE_ENDPOINT || "").trim();
    const region = (process.env.S3_REGION || "auto").trim();
    const accessKey = (process.env.S3_ACCESS_KEY_ID || "").trim();
    const secretKey = (process.env.S3_SECRET_ACCESS_KEY || "").trim();
    if (endpoint && accessKey && secretKey) {
      return { endpoint: endpoint.replace(/\/+$/, ""), region, accessKey, secretKey };
    }
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORAGE !== "true") {
      throw new Error(
        "[Storage] إعدادات التخزين السحابي (S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY) مطلوبة في بيئة الإنتاج.",
      );
    }
    return null;
  }

  /**
   * Uploads and persists a file with strict bucket/path sanitization and payload validation.
   */
  async upload(options: StorageUploadOptions): Promise<{ path: string; size: number }> {
    const cleanBucket = sanitizeBucketName(options.bucket);
    const cleanPath = sanitizeStoragePath(options.path);
    const contentType = options.contentType.toLowerCase().trim();
    validateFilePayload(options.data, contentType, options.sizeLimitBytes ?? DEFAULT_MAX_FILE_SIZE);

    const payloadBuffer = Buffer.isBuffer(options.data) ? options.data : Buffer.from(options.data);
    const s3 = this.getS3Config();

    if (s3) {
      const targetUrl = new URL(`${s3.endpoint}${encodeS3UriPath(cleanBucket, cleanPath)}`);
      const headers = signS3Request({
        method: "PUT",
        url: targetUrl,
        region: s3.region,
        accessKey: s3.accessKey,
        secretKey: s3.secretKey,
        payload: payloadBuffer,
        contentType,
      });
      const res = await fetch(targetUrl, {
        method: "PUT",
        headers,
        body: new Uint8Array(payloadBuffer),
      });
      if (!res.ok) {
        throw new Error(`فشل رفع الملف إلى مخزن S3 (HTTP ${res.status}).`);
      }
      return { path: cleanPath, size: payloadBuffer.length };
    }

    const { filePath, metaPath } = resolveLocalPaths(cleanBucket, cleanPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await mkdir(path.dirname(metaPath), { recursive: true });
    await writeFile(filePath, payloadBuffer);
    await writeFile(
      metaPath,
      JSON.stringify({
        bucket: cleanBucket,
        path: cleanPath,
        size: payloadBuffer.length,
        contentType,
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );

    return { path: cleanPath, size: payloadBuffer.length };
  }

  /**
   * Reads persisted bytes and MIME type for a stored object, or returns null if missing.
   */
  async read(bucket: string, rawPath: string): Promise<StorageReadResult | null> {
    const cleanBucket = sanitizeBucketName(bucket);
    const cleanPath = sanitizeStoragePath(rawPath);
    const s3 = this.getS3Config();

    if (s3) {
      const targetUrl = new URL(`${s3.endpoint}${encodeS3UriPath(cleanBucket, cleanPath)}`);
      const headers = signS3Request({
        method: "GET",
        url: targetUrl,
        region: s3.region,
        accessKey: s3.accessKey,
        secretKey: s3.secretKey,
        payload: Buffer.alloc(0),
      });
      const res = await fetch(targetUrl, { method: "GET", headers });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`تعذر قراءة الملف من مخزن S3 (HTTP ${res.status}).`);
      }
      const arrayBuf = await res.arrayBuffer();
      const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || inferMimeTypeFromPath(cleanPath);
      return { data: Buffer.from(arrayBuf), contentType };
    }

    const { filePath, metaPath } = resolveLocalPaths(cleanBucket, cleanPath);
    try {
      const data = await readFile(filePath);
      let contentType = inferMimeTypeFromPath(cleanPath);
      try {
        const metaRaw = await readFile(metaPath, "utf8");
        const parsed = JSON.parse(metaRaw);
        if (parsed?.contentType) contentType = String(parsed.contentType);
      } catch {
        // Metadata sidecar optional fallback
      }
      return { data, contentType };
    } catch (err: any) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }
  }

  /**
   * Generates a signed, time-limited URL for secure file download.
   */
  createSignedUrl(bucket: string, rawPath: string, expiresInSeconds = 3600): string {
    const cleanBucket = sanitizeBucketName(bucket);
    const cleanPath = sanitizeStoragePath(rawPath);
    const signingSecret = getStorageSigningSecret();
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = createHmac("sha256", signingSecret)
      .update(`${cleanBucket}:${cleanPath}:${expiresAt}`)
      .digest("hex");

    const baseOrigin = process.env.PUBLIC_URL || "";
    return `${baseOrigin}/api/storage/${cleanBucket}/${cleanPath}?exp=${expiresAt}&sig=${signature}`;
  }

  /**
   * Verifies the authenticity of a signed URL request.
   */
  verifySignedUrl(bucket: string, rawPath: string, expiresAt: number, signature: string): boolean {
    if (!Number.isFinite(expiresAt) || !signature || typeof signature !== "string") return false;
    const cleanBucket = sanitizeBucketName(bucket);
    const cleanPath = sanitizeStoragePath(rawPath);
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt < now) return false;

    const signingSecret = getStorageSigningSecret();
    const expectedSignature = createHmac("sha256", signingSecret)
      .update(`${cleanBucket}:${cleanPath}:${expiresAt}`)
      .digest("hex");

    if (signature.length !== expectedSignature.length) return false;
    return timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expectedSignature, "utf8"));
  }
}

export const storageAdapter = new StorageAdapter();
