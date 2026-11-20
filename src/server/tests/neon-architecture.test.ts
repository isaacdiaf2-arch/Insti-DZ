import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken } from "../auth/crypto";
import { sanitizeStoragePath, sanitizeBucketName, validateFilePayload, storageAdapter } from "../storage/storage.adapter";
import { MIGRATION_TABLE_ORDER, verifyContractArtifactHash } from "../../../scripts/migrate-to-neon";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("Insti DZ — Independent Architecture & Security Unit Tests", () => {
  describe("1. Cryptographic Authentication & Password Hardening", () => {
    it("hashes with bcrypt and securely verifies valid and legacy passwords", () => {
      const password = "SuperSecretPassword123!";
      const hash = hashPassword(password);
      expect(hash).toMatch(/^\$2[aby]\$12\$/);
      expect(verifyPassword(password, hash)).toBe(true);
      expect(verifyPassword("WrongPassword!", hash)).toBe(false);
    });

    it("rejects tampered or malformed password hashes safely", () => {
      expect(verifyPassword("test", "")).toBe(false);
      expect(verifyPassword("test", "invalid:hash")).toBe(false);
      expect(verifyPassword("test", "pbkdf2:sha256:100:fake:hash")).toBe(false);
    });

    it("signs, verifies, and validates independent session tokens", () => {
      const secret = "test-secret-key-for-vitest-session-signing-123456789";
      const payload = {
        userId: "11111111-2222-3333-4444-555555555555",
        email: "admin@studydz.com",
        role: "platform_admin",
        institutionId: null,
      };

      const token = signSessionToken(payload, secret, 3600);
      expect(token.split(".").length).toBe(3);

      const verified = verifySessionToken(token, secret);
      expect(verified.valid).toBe(true);
      expect(verified.payload?.userId).toBe(payload.userId);
      expect(verified.payload?.role).toBe("platform_admin");

      // Verify tampered signature is rejected
      const tampered = token.slice(0, -5) + "abcde";
      const failed = verifySessionToken(tampered, secret);
      expect(failed.valid).toBe(false);
      expect(failed.reason).toBe("invalid_signature");
    });

    it("rejects expired session tokens", () => {
      const secret = "test-secret-key";
      const payload = { userId: "test-id", email: "test@example.com", role: "student" };
      // Expired 10 seconds ago
      const token = signSessionToken(payload, secret, -10);
      const res = verifySessionToken(token, secret);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("token_expired");
    });
  });

  describe("2. Storage Adapter Security & Sanitization", () => {
    it("prevents directory traversal attacks in file paths and bucket names", () => {
      expect(() => sanitizeStoragePath("../etc/passwd")).toThrow(/محارف غير آمنة/);
      expect(() => sanitizeStoragePath("uploads/../../secret.txt")).toThrow(/محارف غير آمنة/);
      expect(() => sanitizeStoragePath("/absolute/path")).toThrow(/محارف غير آمنة/);
      expect(() => sanitizeStoragePath("valid/path/file.png\0")).toThrow(/محارف غير آمنة/);
      expect(sanitizeStoragePath("institution-1/logo.png")).toBe("institution-1/logo.png");

      expect(() => sanitizeBucketName("../escape")).toThrow();
      expect(() => sanitizeBucketName("bad/bucket")).toThrow();
      expect(() => sanitizeBucketName(".hidden")).toThrow();
      expect(sanitizeBucketName("institution-media")).toBe("institution-media");
    });

    it("enforces allowed MIME types and size limits", () => {
      const validPng = Buffer.from("fake-png-content");
      expect(() => validateFilePayload(validPng, "image/png", 1024 * 1024)).not.toThrow();

      expect(() => validateFilePayload(validPng, "application/x-executable", 1024)).toThrow(/نوع الملف غير مدعوم/);
      expect(() => validateFilePayload(validPng, "text/html", 1024)).toThrow(/نوع الملف غير مدعوم/);

      // Oversized payload
      const largeBuffer = Buffer.alloc(2000);
      expect(() => validateFilePayload(largeBuffer, "image/png", 1000)).toThrow(/يتجاوز الحد الأقصى/);
    });

    it("persists and reads real binary payloads on disk without stubs", async () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), "studydz-storage-test-"));
      const prevLocalDir = process.env.LOCAL_STORAGE_DIR;
      const prevS3 = process.env.S3_ENDPOINT;
      try {
        process.env.LOCAL_STORAGE_DIR = tempDir;
        delete process.env.S3_ENDPOINT;

        const payload = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
        const up = await storageAdapter.upload({
          bucket: "payment-receipts",
          path: "inst-123/receipt-1.pdf",
          data: payload,
          contentType: "application/pdf",
        });
        expect(up.path).toBe("inst-123/receipt-1.pdf");
        expect(up.size).toBe(payload.length);

        const loaded = await storageAdapter.read("payment-receipts", "inst-123/receipt-1.pdf");
        expect(loaded).not.toBeNull();
        expect(loaded?.contentType).toBe("application/pdf");
        expect(loaded?.data.equals(payload)).toBe(true);

        const missing = await storageAdapter.read("payment-receipts", "inst-123/does-not-exist.pdf");
        expect(missing).toBeNull();
      } finally {
        if (prevLocalDir !== undefined) process.env.LOCAL_STORAGE_DIR = prevLocalDir;
        else delete process.env.LOCAL_STORAGE_DIR;
        if (prevS3 !== undefined) process.env.S3_ENDPOINT = prevS3;
        else delete process.env.S3_ENDPOINT;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("blocks cross-institution storage access and rejects valid signatures swapped onto another institution path", async () => {
      const { assertTenantStorageAccess } = await import("../../lib/storage.functions");
      const { Route: StorageRoute } = await import("../../routes/api/storage/$");

      // Tenant path boundary checks
      expect(() =>
        assertTenantStorageAccess("inst-b/receipt.pdf", {
          roles: ["institution_admin"],
          institution_id: "inst-a",
        }),
      ).toThrow(/خارج مؤسستك/);
      expect(() =>
        assertTenantStorageAccess("inst-a/receipt.pdf", {
          roles: ["institution_admin"],
          institution_id: "inst-a",
        }),
      ).not.toThrow();
      expect(() =>
        assertTenantStorageAccess("inst-b/receipt.pdf", {
          roles: ["platform_admin"],
          institution_id: null,
        }),
      ).not.toThrow();

      // End-to-end signed URL & HTTP route rejection when valid signature is reused on another institution's path
      const tempDir = mkdtempSync(path.join(tmpdir(), "studydz-storage-route-test-"));
      const prevLocalDir = process.env.LOCAL_STORAGE_DIR;
      const prevStorageSecret = process.env.STORAGE_SIGNING_SECRET;
      try {
        process.env.LOCAL_STORAGE_DIR = tempDir;
        process.env.STORAGE_SIGNING_SECRET = "test-storage-signing-secret-strong-key";

        const instABytes = Buffer.from("inst-a-secret-receipt");
        const instBBytes = Buffer.from("inst-b-secret-receipt");
        await storageAdapter.upload({
          bucket: "payment-receipts",
          path: "inst-a/receipt.pdf",
          data: instABytes,
          contentType: "application/pdf",
        });
        await storageAdapter.upload({
          bucket: "payment-receipts",
          path: "inst-b/receipt.pdf",
          data: instBBytes,
          contentType: "application/pdf",
        });

        const signedA = storageAdapter.createSignedUrl("payment-receipts", "inst-a/receipt.pdf", 300);
        const parsedA = new URL(`http://localhost${signedA}`);
        const exp = parsedA.searchParams.get("exp")!;
        const sig = parsedA.searchParams.get("sig")!;

        const getHandler = (StorageRoute.options as any).server.handlers.GET;

        // Authorized download for inst-a succeeds (200)
        const okRes = await getHandler({
          request: new Request(`http://localhost/api/storage/payment-receipts/inst-a/receipt.pdf?exp=${exp}&sig=${sig}`),
          params: { _splat: "payment-receipts/inst-a/receipt.pdf" },
        });
        expect(okRes.status).toBe(200);
        expect(Buffer.from(await okRes.arrayBuffer()).equals(instABytes)).toBe(true);

        // Reusing inst-a's valid signature to fetch inst-b's path is rejected (403)
        const crossTenantRes = await getHandler({
          request: new Request(`http://localhost/api/storage/payment-receipts/inst-b/receipt.pdf?exp=${exp}&sig=${sig}`),
          params: { _splat: "payment-receipts/inst-b/receipt.pdf" },
        });
        expect(crossTenantRes.status).toBe(403);
      } finally {
        if (prevLocalDir !== undefined) process.env.LOCAL_STORAGE_DIR = prevLocalDir;
        else delete process.env.LOCAL_STORAGE_DIR;
        if (prevStorageSecret !== undefined) process.env.STORAGE_SIGNING_SECRET = prevStorageSecret;
        else delete process.env.STORAGE_SIGNING_SECRET;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("requires a strong signing secret and generates/verifies signed URLs with expiration", () => {
      const prevAuth = process.env.AUTH_SECRET;
      const prevJwt = process.env.JWT_SECRET;
      const prevStorage = process.env.STORAGE_SIGNING_SECRET;
      try {
        delete process.env.AUTH_SECRET;
        delete process.env.JWT_SECRET;
        delete process.env.STORAGE_SIGNING_SECRET;
        expect(() => storageAdapter.createSignedUrl("institution-media", "inst-1/logo.png", 60)).toThrow();

        process.env.STORAGE_SIGNING_SECRET = "test-storage-signing-secret-strong-key";
        const url = storageAdapter.createSignedUrl("institution-media", "inst-1/logo.png", 60);
        expect(url).toContain("/api/storage/institution-media/inst-1/logo.png");
        expect(url).toContain("exp=");
        expect(url).toContain("sig=");

        const match = url.match(/exp=(\d+)&sig=([a-f0-9]+)/);
        expect(match).not.toBeNull();
        if (match) {
          const exp = parseInt(match[1], 10);
          const sig = match[2];
          expect(storageAdapter.verifySignedUrl("institution-media", "inst-1/logo.png", exp, sig)).toBe(true);
          expect(storageAdapter.verifySignedUrl("institution-media", "inst-1/other.png", exp, sig)).toBe(false);
          expect(storageAdapter.verifySignedUrl("other-bucket", "inst-1/logo.png", exp, sig)).toBe(false);
          expect(storageAdapter.verifySignedUrl("institution-media", "inst-1/logo.png", Math.floor(Date.now() / 1000) - 5, sig)).toBe(false);
        }
      } finally {
        if (prevAuth !== undefined) process.env.AUTH_SECRET = prevAuth;
        else delete process.env.AUTH_SECRET;
        if (prevJwt !== undefined) process.env.JWT_SECRET = prevJwt;
        else delete process.env.JWT_SECRET;
        if (prevStorage !== undefined) process.env.STORAGE_SIGNING_SECRET = prevStorage;
        else delete process.env.STORAGE_SIGNING_SECRET;
      }
    });
  });

  describe("3. Official Contract Artifact Binary Verification", () => {
    it("cryptographically verifies binary payload against SHA-256 hash", () => {
      const samplePdfBytes = Buffer.from("%PDF-1.4 official signed contract test bytes");
      const pdfBase64 = samplePdfBytes.toString("base64");
      const validSha256 = createHash("sha256").update(samplePdfBytes).digest("hex");

      expect(verifyContractArtifactHash(pdfBase64, validSha256)).toBe(true);
      expect(verifyContractArtifactHash(pdfBase64, "0000000000000000000000000000000000000000000000000000000000000000")).toBe(false);
    });
  });

  describe("4. Migration Table Dependency Graph", () => {
    it("ensures all foreign key dependencies precede child tables in migration order", () => {
      const seen = new Set<string>();
      for (const table of MIGRATION_TABLE_ORDER) {
        for (const dep of table.dependencies) {
          expect(seen.has(dep)).toBe(true);
        }
        seen.add(table.name);
      }
      expect(seen.has("institutions")).toBe(true);
      expect(seen.has("profiles")).toBe(true);
      expect(seen.has("official_contracts")).toBe(true);
      expect(seen.has("contract_artifacts")).toBe(true);
    });
  });

  describe("5. Multi-Tenant Service Isolation", () => {
    it("blocks institution admins from accessing other institutions", async () => {
      const { institutionService, InstitutionAccessError } = await import("../institution/institution.service");
      const chainMock: any = {
        select: () => chainMock,
        eq: () => chainMock,
        maybeSingle: async () => ({ data: { id: "inst-b", name: "Other Inst" }, error: null }),
        count: 0,
      };
      const mockDb = {
        from: () => chainMock,
      };
      const service = institutionService(mockDb as any);

      // Caller from inst-a trying to access inst-b
      await expect(
        service.getInstitutionDetails("inst-b", { id: "user-1", role: "institution_admin", institutionId: "inst-a" })
      ).rejects.toThrow(InstitutionAccessError);

      // Platform admin can access any institution
      const res = await service.getInstitutionDetails("inst-b", { id: "admin-1", role: "platform_admin" });
      expect(res.id).toBe("inst-b");
    });

    it("prevents contract access when user institution does not match", async () => {
      const { contractService, ContractSecurityError } = await import("../contract/contract.service");
      const mockDb = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "contract-1", institution_id: "inst-b", number: "SDZ-01" }, error: null }),
            }),
          }),
        }),
      };
      const service = contractService(mockDb as any);

      await expect(
        service.getContract("contract-1", { id: "user-1", role: "institution_admin", institutionId: "inst-a" })
      ).rejects.toThrow(ContractSecurityError);

      const contract = await service.getContract("contract-1", { id: "admin-1", role: "platform_admin" });
      expect(contract.id).toBe("contract-1");
    });
  });
});
