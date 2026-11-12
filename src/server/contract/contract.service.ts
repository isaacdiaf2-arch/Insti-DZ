import type { DbClient } from "@/server/db/adapter";
import { contractRepository } from "./contract.repository";
import { createHash } from "node:crypto";

export class ContractSecurityError extends Error {
  constructor(message: string, public statusCode = 403) {
    super(message);
    this.name = "ContractSecurityError";
  }
}

export function contractService(db: DbClient) {
  const repo = contractRepository(db);

  return {
    async getContract(id: string, user: { id: string; role: string; institutionId?: string | null }) {
      const contract = await repo.findContractById(id);
      if (!contract) {
        throw new ContractSecurityError("العقد غير موجود أو غير متاح.", 404);
      }

      if (user.role !== "platform_admin" && contract.institution_id !== user.institutionId) {
        throw new ContractSecurityError("غير مصرح: ليس لديك صلاحية الوصول إلى هذا العقد.", 403);
      }

      return contract;
    },

    async downloadVerifiedArtifact(contractId: string, user: { id: string; role: string; institutionId?: string | null }) {
      const contract = await this.getContract(contractId, user);
      const artifact = await repo.findArtifactByContractId(contractId);

      if (!artifact || !artifact.pdf_base64) {
        throw new ContractSecurityError("النسخة النهائية الموقعة غير متاحة بعد.", 404);
      }

      // Cryptographic SHA-256 verification of the stored binary bytes
      const decodedBytes = Buffer.from(artifact.pdf_base64, "base64");
      const computedHash = createHash("sha256").update(decodedBytes).digest("hex");

      if (computedHash.toLowerCase() !== artifact.sha256.toLowerCase()) {
        throw new ContractSecurityError("فشل التحقق من البصمة الرقمية للوثيقة؛ تم إيقاف التنزيل لمنع تداول نسخة تالفة أو معدلة.", 500);
      }

      await repo.logContractDownload(user.id, contract.institution_id, contractId, artifact.sha256);

      return {
        contractId,
        sha256: artifact.sha256,
        pdfBase64: artifact.pdf_base64,
        pdf_base64: artifact.pdf_base64,
        sizeBytes: decodedBytes.length,
      };
    },

    async signByInstitution(params: {
      contractId: string;
      actorId: string;
      expectedHash: string;
      evidence: any;
    }) {
      await repo.transitionContract({
        id: params.contractId,
        actor: params.actorId,
        action: "institution_sign",
        hash: params.expectedHash,
        evidence: params.evidence,
      });
    },

    async signByPlatform(params: {
      contractId: string;
      actorId: string;
      expectedHash: string;
      evidence: any;
      pdfBase64: string;
      pdfHash: string;
    }) {
      // Verify client-provided hash matches actual binary payload
      const computedHash = createHash("sha256").update(Buffer.from(params.pdfBase64, "base64")).digest("hex");
      if (computedHash.toLowerCase() !== params.pdfHash.toLowerCase()) {
        throw new ContractSecurityError("تجزئة ملف العقد غير مطابقة لمحتواه الفعلي.", 400);
      }

      await repo.transitionContract({
        id: params.contractId,
        actor: params.actorId,
        action: "platform_sign",
        hash: params.expectedHash,
        evidence: params.evidence,
        pdf: params.pdfBase64,
        pdfHash: params.pdfHash,
      });
    },

    async returnForCorrection(params: {
      contractId: string;
      actorId: string;
      expectedHash: string;
      note: string;
    }) {
      if (!params.note || params.note.trim().length < 5) {
        throw new ContractSecurityError("سبب إعادة العقد للتصحيح مطلوب ويجب أن يكون 5 أحرف على الأقل.", 400);
      }

      await repo.transitionContract({
        id: params.contractId,
        actor: params.actorId,
        action: "return",
        hash: params.expectedHash,
        note: params.note.trim(),
      });
    },
  };
}
