import { desc, eq } from "drizzle-orm";
import type { DbClient } from "@/server/db/adapter";
import { auditLogs, contractArtifacts, officialContracts } from "../../../drizzle/schema";

export function contractRepository(db: DbClient) {
  const drizzleDb = db?.drizzle;

  return {
    async findContractById(id: string) {
      if (drizzleDb) {
        const [row] = await drizzleDb
          .select({
            id: officialContracts.id,
            institution_id: officialContracts.institutionId,
            number: officialContracts.number,
            version: officialContracts.version,
            state: officialContracts.state,
            content_hash: officialContracts.contentHash,
            fields: officialContracts.fields,
            provider: officialContracts.provider,
            legal_text: officialContracts.legalText,
            institution_evidence: officialContracts.institutionEvidence,
            platform_evidence: officialContracts.platformEvidence,
            correction_note: officialContracts.correctionNote,
            replaces_id: officialContracts.replacesId,
            created_by: officialContracts.createdBy,
            created_at: officialContracts.createdAt,
            updated_at: officialContracts.updatedAt,
          })
          .from(officialContracts)
          .where(eq(officialContracts.id, id))
          .limit(1);
        return row ?? null;
      }

      const { data, error } = await db
        .from("official_contracts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`Database error fetching contract: ${error.message}`);
      return data;
    },

    async findArtifactByContractId(contractId: string) {
      if (drizzleDb) {
        const [row] = await drizzleDb
          .select({
            contract_id: contractArtifacts.contractId,
            pdf_base64: contractArtifacts.pdfBase64,
            sha256: contractArtifacts.sha256,
            created_at: contractArtifacts.createdAt,
          })
          .from(contractArtifacts)
          .where(eq(contractArtifacts.contractId, contractId))
          .limit(1);
        return row ?? null;
      }

      const { data, error } = await db
        .from("contract_artifacts")
        .select("contract_id, pdf_base64, sha256, created_at")
        .eq("contract_id", contractId)
        .maybeSingle();
      if (error) throw new Error(`Database error fetching artifact: ${error.message}`);
      return data;
    },

    async listContractsForInstitution(institutionId: string) {
      if (drizzleDb) {
        return drizzleDb
          .select({
            id: officialContracts.id,
            number: officialContracts.number,
            version: officialContracts.version,
            state: officialContracts.state,
            created_at: officialContracts.createdAt,
            updated_at: officialContracts.updatedAt,
            content_hash: officialContracts.contentHash,
          })
          .from(officialContracts)
          .where(eq(officialContracts.institutionId, institutionId))
          .orderBy(desc(officialContracts.createdAt));
      }

      const { data, error } = await db
        .from("official_contracts")
        .select("id, number, version, state, created_at, updated_at, content_hash")
        .eq("institution_id", institutionId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`Database error listing contracts: ${error.message}`);
      return data ?? [];
    },

    async transitionContract(params: {
      id: string;
      actor: string;
      action: "institution_sign" | "platform_sign" | "return";
      hash: string;
      evidence?: any;
      pdf?: string;
      pdfHash?: string;
      note?: string;
    }) {
      const { error } = await db.rpc("transition_official_contract", {
        _id: params.id,
        _actor: params.actor,
        _action: params.action,
        _hash: params.hash,
        _evidence: params.evidence ?? null,
        _pdf: params.pdf ?? null,
        _pdf_hash: params.pdfHash ?? null,
        _note: params.note ?? null,
      });
      if (error) throw new Error(`Contract transition failed: ${error.message}`);
    },

    async logContractDownload(actorId: string, institutionId: string, contractId: string, sha256: string) {
      if (drizzleDb) {
        await drizzleDb.insert(auditLogs).values({
          actorId,
          institutionId,
          action: "contract_download_verified",
          resource: "official_contract",
          resourceId: contractId,
          result: "success",
          metadata: { sha256 },
        });
        return;
      }

      const { error } = await db.from("audit_logs").insert({
        actor_id: actorId,
        institution_id: institutionId,
        action: "contract_download_verified",
        resource: "official_contract",
        resource_id: contractId,
        result: "success",
        metadata: { sha256 },
      });
      if (error) throw new Error(`Failed to log contract download: ${error.message}`);
    },
  };
}
