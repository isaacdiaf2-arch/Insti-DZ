import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SUBSCRIPTION_AMOUNT = 9000;

/**
 * رفع وصل دفع CCP من طرف مدير المؤسسة.
 * يُرفع الملف إلى Supabase Storage ثم يُنشأ سجل payment حقيقي.
 * يمنع إنشاء payment مكرر إذا كان هناك طلب قيد المراجعة.
 */
export const submitPaymentProof = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amount: z.number().int().min(100).max(100000),
        reference: z.string().trim().max(200).optional().nullable(),
        institutionName: z.string().trim().min(2).max(200),
        proofPath: z.string().trim().min(5).max(500),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: role } = await context.supabase
      .from("user_roles")
      .select("institution_id")
      .eq("user_id", context.userId)
      .eq("role", "institution_admin")
      .maybeSingle();
    if (!role?.institution_id) throw new Error("غير مسموح: هذه العملية لمدير المؤسسة فقط.");
    const institutionId = role.institution_id as string;

    const { data: existing } = await supabaseAdmin
      .from("payments")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) throw new Error("يوجد طلب دفع قيد المراجعة بالفعل. انتظر قرار الإدارة.");

    const { error } = await supabaseAdmin.from("payments").insert({
      institution_id: institutionId,
      amount: data.amount,
      method: "CCP",
      paid_at: data.paidAt,
      proof_url: data.proofPath,
      reference: data.reference ?? null,
      note: `اسم المؤسسة على الوصل: ${data.institutionName}`,
      status: "pending",
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      actor_role: "institution_admin",
      institution_id: institutionId,
      action: "payment.submitted",
      resource: "payments",
      result: "success",
      metadata: { amount: data.amount, method: "CCP", paid_at: data.paidAt } as never,
    });

    return { ok: true as const };
  });

export function mapPaymentDecisionToStatus(
  decision: "verified" | "accepted" | "rejected" | "needs_modification",
): "pending" | "verified" | "rejected" {
  if (decision === "verified" || decision === "accepted") return "verified";
  if (decision === "rejected") return "rejected";
  return "pending";
}

/**
 * مراجعة الدفع من طرف مدير المنصة — قبول / رفض / طلب تعديل.
 * لا يوجد تفعيل تلقائي بمجرد رفع الوصل.
 */
export const reviewPaymentWithAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        paymentId: z.string().uuid(),
        decision: z.enum(["verified", "accepted", "rejected", "needs_modification"]),
        rejectionReason: z.string().trim().max(500).optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { requirePlatformAdmin } = await import("./contracts.server");
    await requirePlatformAdmin(context);

    const { data: payment, error: fetchErr } = await supabaseAdmin
      .from("payments")
      .select("id, institution_id, status, amount")
      .eq("id", data.paymentId)
      .maybeSingle();
    if (fetchErr || !payment) throw new Error("طلب الدفع غير موجود.");
    if (payment.status !== "pending")
      throw new Error("تمت معالجة هذا الطلب مسبقاً.");

    const nowIso = new Date().toISOString();

    const targetStatus = mapPaymentDecisionToStatus(data.decision);

    if (targetStatus === "verified") {
      const expires = new Date();
      expires.setFullYear(expires.getFullYear() + 1);
      const expiresAt = expires.toISOString().slice(0, 10);

      await supabaseAdmin
        .from("payments")
        .update({
          status: targetStatus,
          reviewed_at: nowIso,
          expires_at: expiresAt,
          rejection_reason: null,
        })
        .eq("id", data.paymentId);

      await supabaseAdmin
        .from("institutions")
        .update({ status: "active", subscription_end: expiresAt })
        .eq("id", payment.institution_id);

      await notifyInstitutionAdmins(supabaseAdmin, payment.institution_id, {
        institution_id: payment.institution_id,
        sender_id: context.userId,
        type: "payment",
        title: "تم قبول الدفع وتفعيل الاشتراك",
        body: `تم قبول وصل الدفع وتفعيل اشتراك مؤسستك لمدة سنة، ينتهي في ${expiresAt}.`,
      });
    } else {
      await supabaseAdmin
        .from("payments")
        .update({
          status: targetStatus,
          reviewed_at: nowIso,
          rejection_reason: data.rejectionReason ?? null,
        })
        .eq("id", data.paymentId);

      await notifyInstitutionAdmins(supabaseAdmin, payment.institution_id, {
        institution_id: payment.institution_id,
        sender_id: context.userId,
        type: "payment",
        title:
          data.decision === "rejected"
            ? "تم رفض وصل الدفع"
            : "طلب تعديل وصل الدفع",
        body: data.rejectionReason ?? "يرجى مراجعة الطلب وإعادة الرفع.",
      });
    }

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      actor_role: "platform_admin",
      institution_id: payment.institution_id,
      action: `payment.${data.decision}`,
      resource: "payments",
      resource_id: data.paymentId,
      result: "success",
      metadata: { reason: data.rejectionReason ?? null, amount: payment.amount } as never,
    });

    return { ok: true as const };
  });

async function notifyInstitutionAdmins(
  admin: any,
  institutionId: string,
  payload: Record<string, unknown>,
) {
  const { data: admins } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "institution_admin")
    .eq("institution_id", institutionId);
  const rows = ((admins ?? []) as { user_id: string }[]).map((a) => ({ ...payload, recipient_id: a.user_id }));
  if (rows.length) await admin.from("notifications").insert(rows);
}

/**
 * جلب سجل مدفوعات المؤسسة الحالية لمدير المؤسسة.
 */
export const getInstitutionPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("institution_id")
      .eq("user_id", context.userId)
      .eq("role", "institution_admin")
      .maybeSingle();
    if (!role?.institution_id) return [];

    const { data, error } = await db
      .from("payments")
      .select("*")
      .eq("institution_id", role.institution_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
