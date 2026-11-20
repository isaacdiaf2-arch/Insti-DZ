import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Admin;
}

async function assertPlatformAdmin(context: { supabase: any; userId: string }) {
  const { requirePlatformAdmin } = await import("./contracts.server");
  await requirePlatformAdmin(context);
}

export async function writeAudit(
  db: Admin,
  entry: {
    actorId?: string | null;
    actorRole?: string | null;
    institutionId?: string | null;
    action: string;
    resource?: string | null;
    resourceId?: string | null;
    result?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await db.from("audit_logs").insert({
    actor_id: entry.actorId ?? null,
    actor_role: entry.actorRole ?? null,
    institution_id: entry.institutionId ?? null,
    action: entry.action,
    resource: entry.resource ?? null,
    resource_id: entry.resourceId ?? null,
    result: entry.result ?? "success",
    metadata: (entry.metadata ?? {}) as never,
  });
}

export async function notify(
  db: Admin,
  entry: {
    recipientId: string;
    institutionId?: string | null;
    senderId?: string | null;
    type?: string;
    title: string;
    body?: string;
    link?: string | null;
  },
) {
  await db.from("notifications").insert({
    recipient_id: entry.recipientId,
    institution_id: entry.institutionId ?? null,
    sender_id: entry.senderId ?? null,
    type: entry.type ?? "system",
    title: entry.title,
    body: entry.body ?? "",
    link: entry.link ?? null,
  });
}

/** مراجعة طلب تسجيل المؤسسة: قبول / رفض / تعليق / أرشفة */
export const reviewInstitution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        institutionId: z.string().uuid(),
        decision: z.enum(["approved", "active", "suspended", "archived", "rejected"]),
        reason: z.string().max(500).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as never);
    const db = await admin();

    const nowIso = new Date().toISOString();
    const status = data.decision === "rejected" ? "pending" : data.decision;

    const { data: inst, error } = await db
      .from("institutions")
      .update({
        status: status as never,
        reviewed_by: context.userId,
        reviewed_at: nowIso,
        rejection_reason: data.decision === "rejected" ? (data.reason ?? "") : null,
        archived_at: data.decision === "archived" ? nowIso : null,
      })
      .eq("id", data.institutionId)
      .select("id, name, owner_id")
      .single();
    if (error) throw new Error(error.message);

    const labels: Record<string, string> = {
      approved: "تمت الموافقة على مؤسستك",
      active: "تم تفعيل مؤسستك",
      suspended: "تم تعليق حساب مؤسستك",
      archived: "تمت أرشفة مؤسستك",
      rejected: "تم رفض طلب تسجيل مؤسستك",
    };

    if (inst.owner_id) {
      await notify(db, {
        recipientId: inst.owner_id,
        institutionId: inst.id,
        senderId: context.userId,
        type: "institution",
        title: labels[data.decision],
        body: data.reason ?? "",
      });
    }

    await writeAudit(db, {
      actorId: context.userId,
      actorRole: "platform_admin",
      institutionId: inst.id,
      action: `institution.${data.decision}`,
      resource: "institutions",
      resourceId: inst.id,
      metadata: { reason: data.reason ?? null },
    });

    return { ok: true };
  });

/** إصدار فاتورة رسمية لدفعة مقبولة */
export const issueInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ paymentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as never);
    const db = await admin();

    const { data: payment, error } = await db
      .from("payments")
      .select("id, institution_id, amount, method, status, paid_at, expires_at")
      .eq("id", data.paymentId)
      .single();
    if (error) throw new Error(error.message);
    if (payment.status !== "verified" && payment.status !== "accepted") {
      throw new Error("لا يمكن إصدار فاتورة لدفعة غير مقبولة.");
    }

    const { data: existing } = await db
      .from("invoices")
      .select("id, number")
      .eq("payment_id", payment.id)
      .maybeSingle();
    if (existing) return { ok: true, number: existing.number };

    const year = new Date().getFullYear();
    const { count } = await db.from("invoices").select("id", { count: "exact", head: true });
    const number = `SDZ-${year}-${String((count ?? 0) + 1).padStart(5, "0")}`;

    const { error: insErr } = await db.from("invoices").insert({
      number,
      institution_id: payment.institution_id,
      payment_id: payment.id,
      amount: payment.amount,
      method: payment.method,
      status: "paid",
      period_start: payment.paid_at ? payment.paid_at.slice(0, 10) : null,
      period_end: payment.expires_at,
    });
    if (insErr) throw new Error(insErr.message);

    await writeAudit(db, {
      actorId: context.userId,
      actorRole: "platform_admin",
      institutionId: payment.institution_id,
      action: "invoice.issued",
      resource: "invoices",
      resourceId: payment.id,
      metadata: { amount: payment.amount, invoice_number: number },
    });

    return { ok: true, number };
  });

export function resolveChangeRequestScope(
  claims: { roles: string[]; institution_id: string | null },
  target: "profile" | "institution" | "institution_settings",
  requestedInstitutionId?: string | null,
): string | null {
  const isPlatform = claims.roles.includes("platform_admin");
  if (target === "profile") {
    if (
      !isPlatform &&
      requestedInstitutionId &&
      claims.institution_id &&
      requestedInstitutionId !== claims.institution_id
    ) {
      throw new Error("غير مصرح: لا يمكنك إسناد طلب تعديل إلى مؤسسة أخرى.");
    }
    return isPlatform ? (requestedInstitutionId ?? claims.institution_id ?? null) : (claims.institution_id ?? null);
  }

  const isInstAdmin = claims.roles.includes("institution_admin");
  if (!isPlatform && !isInstAdmin) {
    throw new Error("غير مسموح: طلب تعديل بيانات المؤسسة مخصص لمدير المؤسسة فقط.");
  }

  if (isPlatform) {
    if (!requestedInstitutionId && !claims.institution_id) {
      throw new Error("يرجى تحديد معرّف المؤسسة.");
    }
    return requestedInstitutionId ?? claims.institution_id ?? null;
  }

  if (!claims.institution_id) {
    throw new Error("المستخدم غير مرتبط بأي مؤسسة.");
  }
  if (requestedInstitutionId && requestedInstitutionId !== claims.institution_id) {
    throw new Error("غير مصرح: لا يمكنك تقديم طلب تعديل لمؤسسة أخرى.");
  }
  return claims.institution_id;
}

/** طلب تعديل بيانات حساسة (يُراجَع من مدير المنصة) */
export const submitChangeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        target: z.enum(["profile", "institution", "institution_settings"]),
        institutionId: z.string().uuid().nullable().optional(),
        newValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const scopedInstitutionId = resolveChangeRequestScope(
      context.claims,
      data.target,
      data.institutionId ?? null,
    );

    let oldValues: Record<string, unknown> = {};
    if (data.target === "profile") {
      const { data: p } = await db
        .from("profiles")
        .select("id, email, first_name, last_name, phone, avatar_url, institution_id")
        .eq("id", context.userId)
        .maybeSingle();
      oldValues = (p ?? {}) as Record<string, unknown>;
    } else if (scopedInstitutionId) {
      const { data: i } = await db
        .from("institutions")
        .select("*")
        .eq("id", scopedInstitutionId)
        .maybeSingle();
      oldValues = (i ?? {}) as Record<string, unknown>;
    }

    const filteredOld: Record<string, unknown> = {};
    for (const key of Object.keys(data.newValues)) filteredOld[key] = oldValues[key] ?? null;

    const { error } = await db.from("change_requests").insert({
      requester_id: context.userId,
      institution_id: scopedInstitutionId,
      target: data.target,
      old_values: filteredOld as never,
      new_values: data.newValues as never,
      status: "pending",
    });
    if (error) throw new Error(error.message);

    await writeAudit(db, {
      actorId: context.userId,
      institutionId: scopedInstitutionId,
      action: "change_request.created",
      resource: "change_requests",
      metadata: { target: data.target },
    });

    return { ok: true };
  });

/** قرار مدير المنصة على طلب التعديل */
export const reviewChangeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        note: z.string().max(500).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as never);
    const db = await admin();

    const { data: req, error } = await db
      .from("change_requests")
      .select("*")
      .eq("id", data.requestId)
      .single();
    if (error) throw new Error(error.message);
    if (req.status !== "pending") throw new Error("تمت معالجة هذا الطلب مسبقاً.");

    if (data.decision === "approved") {
      const values = req.new_values as Record<string, unknown>;
      if (req.target === "profile") {
        const allowed = ["first_name", "last_name", "phone", "email", "avatar_url"];
        const patch: Record<string, unknown> = {};
        for (const k of allowed) if (k in values) patch[k] = values[k];
        if (Object.keys(patch).length)
          await db.from("profiles").update(patch as never).eq("id", req.requester_id);
      } else if (req.institution_id) {
        const allowed = [
          "name",
          "name_fr",
          "type",
          "address",
          "wilaya",
          "commune",
          "phone",
          "email",
          "website",
          "logo_url",
          "cover_url",
          "primary_color",
          "facebook_url",
          "instagram_url",
          "maps_url",
          "accreditation_number",
          "accreditation_authority",
          "commercial_register",
          "legal_representative",
        ];
        const patch: Record<string, unknown> = {};
        for (const k of allowed) if (k in values) patch[k] = values[k];
        if (Object.keys(patch).length)
          await db.from("institutions").update(patch as never).eq("id", req.institution_id);
      }
    }

    await db
      .from("change_requests")
      .update({
        status: data.decision,
        reviewer_id: context.userId,
        reviewed_at: new Date().toISOString(),
        decision_note: data.note ?? null,
      })
      .eq("id", req.id);

    await notify(db, {
      recipientId: req.requester_id,
      institutionId: req.institution_id,
      senderId: context.userId,
      type: "change_request",
      title: data.decision === "approved" ? "تمت الموافقة على طلب التعديل" : "تم رفض طلب التعديل",
      body: data.note ?? "",
    });

    await writeAudit(db, {
      actorId: context.userId,
      actorRole: "platform_admin",
      institutionId: req.institution_id,
      action: `change_request.${data.decision}`,
      resource: "change_requests",
      resourceId: req.id,
    });

    return { ok: true };
  });

export const listReviewInstitutions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context as any);
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { data, error } = await db
      .from("institutions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).filter((i: any) => i.status === "pending" || i.status === "approved");
  });

export const listChangeRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context as any);
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { data, error } = await db
      .from("change_requests")
      .select("*, institutions(name)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listAuditLogsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ action: z.string().optional() }).optional().parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as any);
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    let q = db
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data?.action && data.action !== "all") {
      q = q.eq("action", data.action);
    }
    const res = await q;
    return res.data ?? [];
  });

export const listInvoicesData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context as any);
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const [invoicesRes, instRes] = await Promise.all([
      db.from("invoices").select("*, institutions(name)").order("issued_at", { ascending: false }),
      db.from("institutions").select("id, name, status").order("name"),
    ]);
    return {
      invoices: invoicesRes.data ?? [],
      institutions: (instRes.data ?? []).filter((i: any) => i.status === "active"),
    };
  });

export function resolveInvoiceListScope(
  claims: { roles: string[]; institution_id: string | null },
  requestedInstitutionId?: string,
): { isPlatform: boolean; institutionId: string | null } {
  const isPlatform = claims.roles.includes("platform_admin");
  if (isPlatform) {
    return { isPlatform: true, institutionId: requestedInstitutionId ?? null };
  }
  const isInstAdmin = claims.roles.includes("institution_admin");
  if (!isInstAdmin || !claims.institution_id) {
    throw new Error("غير مسموح: عرض الفواتير مخصص لإدارة المؤسسة أو المنصة فقط.");
  }
  if (requestedInstitutionId && requestedInstitutionId !== claims.institution_id) {
    throw new Error("غير مصرح: لا يمكنك عرض فواتير مؤسسة أخرى.");
  }
  return { isPlatform: false, institutionId: claims.institution_id };
}

export const listInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ institutionId: z.string().uuid().optional() }).optional().parse(input),
  )
  .handler(async ({ data, context }) => {
    const scope = resolveInvoiceListScope(context.claims, data?.institutionId);
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    let q = db
      .from("invoices")
      .select("*, institutions(name, wilaya, commune, email)")
      .order("issued_at", { ascending: false });
    if (scope.institutionId) q = q.eq("institution_id", scope.institutionId);
    const res = await q;
    return res.data ?? [];
  });

export const listIssuablePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context as any);
    const { getServiceDb } = await import("@/server/db/adapter");
    const db = await getServiceDb();
    const { data, error } = await db
      .from("payments")
      .select("id, amount, paid_at, institution_id, institutions(name)")
      .eq("status", "verified")
      .order("paid_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
