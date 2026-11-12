import type { DbClient } from "@/server/db/adapter";

export function contractRepository(db: DbClient) {
  return {
    async findContractById(id: string) {
      const { data, error } = await db
        .from("official_contracts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`Database error fetching contract: ${error.message}`);
      return data;
    },

    async findArtifactByContractId(contractId: string) {
      const { data, error } = await db
        .from("contract_artifacts")
        .select("contract_id, pdf_base64, sha256, created_at")
        .eq("contract_id", contractId)
        .maybeSingle();
      if (error) throw new Error(`Database error fetching artifact: ${error.message}`);
      return data;
    },

    async listContractsForInstitution(institutionId: string) {
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
      await db.from("audit_logs").insert({
        actor_id: actorId,
        institution_id: institutionId,
        action: "contract_download_verified",
        resource: "official_contract",
        resource_id: contractId,
        result: "success",
        metadata: { sha256 },
      });
    },
  };
}
