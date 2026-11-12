import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken } from "../auth/crypto";
import { sanitizeStoragePath, validateFilePayload, storageAdapter } from "../storage/storage.adapter";
import { MIGRATION_TABLE_ORDER, verifyContractArtifactHash } from "../../../scripts/migrate-to-neon";
import { createHash } from "node:crypto";

describe("Study DZ — Independent Architecture & Security Unit Tests", () => {
  describe("1. Cryptographic Authentication & Password Hardening", () => {
    it("hashes and securely verifies valid passwords", () => {
      const password = "SuperSecretPassword123!";
      const hash = hashPassword(password);
      expect(hash).toMatch(/^pbkdf2:sha256:100000:[a-f0-9]{32}:[a-f0-9]{128}$/);
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
    it("prevents directory traversal attacks in file paths", () => {
      expect(() => sanitizeStoragePath("../etc/passwd")).toThrow(/محارف غير آمنة/);
      expect(() => sanitizeStoragePath("uploads/../../secret.txt")).toThrow(/محارف غير آمنة/);
      expect(() => sanitizeStoragePath("/absolute/path")).toThrow(/محارف غير آمنة/);
      expect(() => sanitizeStoragePath("valid/path/file.png\0")).toThrow(/محارف غير آمنة/);
      expect(sanitizeStoragePath("institution-1/logo.png")).toBe("institution-1/logo.png");
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

    it("generates and verifies signed URLs with expiration", () => {
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
      const service = institutionService(mockDb);

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
      const service = contractService(mockDb);

      await expect(
        service.getContract("contract-1", { id: "user-1", role: "institution_admin", institutionId: "inst-a" })
      ).rejects.toThrow(ContractSecurityError);

      const contract = await service.getContract("contract-1", { id: "admin-1", role: "platform_admin" });
      expect(contract.id).toBe("contract-1");
    });
  });
});
