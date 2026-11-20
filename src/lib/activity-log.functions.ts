import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "./contracts.server";

const input = z.object({
  pin: z.string().min(1).max(20),
  search: z.string().max(100).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.number().int().min(0).max(1000).default(0),
});

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function assertActivityLogPinConfigured(envPin = process.env["ACTIVITY_LOG_PIN"]) {
  const expected = (envPin ?? "").trim();
  if (!expected) {
    throw new Error("لم يتم تهيئة رمز PIN لسجل العمليات في إعدادات الخادم (ACTIVITY_LOG_PIN).");
  }
  return expected;
}

export const listPlatformActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const expected = assertActivityLogPinConfigured();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count } = await supabaseAdmin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", context.userId)
      .eq("action", "activity_pin_failed")
      .gte("created_at", since);
    if ((count ?? 0) >= 5) throw new Error("محاولات كثيرة. أعد المحاولة بعد 15 دقيقة.");
    if (!timingSafeEqual(data.pin, expected)) {
      await supabaseAdmin.from("audit_logs").insert({
        actor_id: context.userId, actor_role: "platform_admin", action: "activity_pin_failed",
        resource: "activity_log", result: "denied",
      });
      throw new Error("رمز PIN غير صحيح.");
    }
    const size = 100;
    let q = supabaseAdmin
      .from("audit_logs")
      .select("id,actor_id,actor_role,institution_id,action,resource,resource_id,result,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.page * size, data.page * size + size - 1);
    if (data.day) {
      // Algiers is UTC+1 year-round
      const start = new Date(`${data.day}T00:00:00+01:00`);
      q = q.gte("created_at", start.toISOString()).lt("created_at", new Date(start.getTime() + 86400000).toISOString());
    }
    const s = data.search?.trim().replace(/[%,()]/g, "");
    if (s) q = q.or(`action.ilike.%${s}%,resource.ilike.%${s}%,resource_id.ilike.%${s}%`);
    const { data: rows, count: total, error } = await q;
    if (error) throw new Error("تعذر تحميل السجل.");
    const rowList = (rows ?? []) as Array<{
      id: string;
      actor_id: string | null;
      actor_role: string | null;
      institution_id: string | null;
      action: string;
      resource: string | null;
      resource_id: string | null;
      result: string;
      created_at: string;
    }>;
    const actorIds = [...new Set(rowList.map((r) => r.actor_id).filter((id): id is string => Boolean(id)))];
    const instIds = [...new Set(rowList.map((r) => r.institution_id).filter((id): id is string => Boolean(id)))];
    const [actors, insts] = await Promise.all([
      actorIds.length ? supabaseAdmin.from("profiles").select("id,first_name,last_name").in("id", actorIds) : { data: [] },
      instIds.length ? supabaseAdmin.from("institutions").select("id,name").in("id", instIds) : { data: [] },
    ]);
    const an = new Map<string, string>(
      ((actors.data ?? []) as Array<{ id: string; first_name?: string | null; last_name?: string | null }>).map((a) => [
        a.id,
        `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim(),
      ]),
    );
    const inn = new Map<string, string>(
      ((insts.data ?? []) as Array<{ id: string; name?: string | null }>).map((i) => [i.id, i.name ?? ""]),
    );
    return {
      total: total ?? 0,
      pageSize: size,
      rows: rowList.map((r) => ({
        ...r,
        actor_name: r.actor_id ? an.get(r.actor_id) ?? null : null,
        institution_name: r.institution_id ? inn.get(r.institution_id) ?? null : null,
      })),
    };
  });
