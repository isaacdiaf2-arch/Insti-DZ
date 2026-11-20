import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/dashboard/DashboardShell";
import {
  reviewInstitution,
  reviewChangeRequest,
  issueInvoice,
  listReviewInstitutions,
  listChangeRequests,
  listAuditLogsAdmin,
  listInvoices,
  listIssuablePayments,
} from "@/lib/governance.functions";

function fmt(date: string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleString("ar-DZ", { dateStyle: "short", timeStyle: "short" });
}

interface ReviewInstitutionRow {
  id: string;
  name: string;
  status: string;
  type: string;
  wilaya: string;
  commune: string;
  email: string;
  created_at: string;
  rejection_reason?: string | null;
}

interface ChangeRequestRow {
  id: string;
  target: string;
  status: string;
  created_at: string;
  old_values: unknown;
  new_values: unknown;
  decision_note?: string | null;
}

interface AuditLogRow {
  id: string;
  action: string;
  resource?: string | null;
  resource_id?: string | null;
  actor_role?: string | null;
  result: string;
  created_at: string;
}

interface InvoiceRow {
  id: string;
  number: string;
  payment_id?: string | null;
  amount: number | string;
  method: string;
  status: string;
  issued_at: string;
  period_start?: string | null;
  period_end?: string | null;
  institutions?: { name?: string } | null;
}

interface IssuablePaymentRow {
  id: string;
  amount: number | string;
  paid_at: string;
  institutions?: { name?: string } | null;
}

/** مراجعة طلبات تسجيل المؤسسات: قبول / رفض بسبب / تعليق / أرشفة */
export function InstitutionReviewPanel() {
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const review = useServerFn(reviewInstitution);
  const fetchPending = useServerFn(listReviewInstitutions);

  const pending = useQuery<ReviewInstitutionRow[]>({
    queryKey: ["admin", "institution-review"],
    queryFn: async () => (await fetchPending()) as ReviewInstitutionRow[],
  });

  const decide = useMutation({
    mutationFn: (vars: {
      institutionId: string;
      decision: "approved" | "active" | "suspended" | "archived" | "rejected";
      reason?: string;
    }) => review({ data: vars }),
    onSuccess: () => {
      toast.success("تم تسجيل القرار وإشعار المؤسسة");
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = pending.data ?? [];

  return (
    <section className="card-soft p-4">
      <h2 className="font-display text-lg font-extrabold">طلبات تسجيل المؤسسات</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        لا يوجد قبول تلقائي — كل مؤسسة تمر بمراجعة مدير المنصة (قبول / رفض بسبب).
      </p>
      <div className="mt-4 space-y-3">
        {list.length === 0 && <EmptyState text="لا توجد طلبات بانتظار المراجعة" />}
        {list.map((inst) => (
          <div key={inst.id} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display font-bold">{inst.name}</span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                {inst.status === "pending" ? "قيد المراجعة" : "مقبولة — بانتظار التفعيل"}
              </span>
              <span className="text-xs text-muted-foreground">
                {inst.type} · {inst.wilaya} / {inst.commune}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {inst.email} · مُرسل في {fmt(inst.created_at)}
              {inst.rejection_reason ? ` · سبب الرفض السابق: ${inst.rejection_reason}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                className="h-9 max-w-xs"
                placeholder="سبب الرفض (إلزامي عند الرفض)"
                value={reasons[inst.id] ?? ""}
                onChange={(e) => setReasons((p) => ({ ...p, [inst.id]: e.target.value }))}
              />
              <Button
                size="sm"
                onClick={() => decide.mutate({ institutionId: inst.id, decision: "approved" })}
              >
                قبول
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => decide.mutate({ institutionId: inst.id, decision: "active" })}
              >
                تفعيل
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const reason = (reasons[inst.id] ?? "").trim();
                  if (!reason) {
                    toast.error("يجب كتابة سبب الرفض");
                    return;
                  }
                  decide.mutate({ institutionId: inst.id, decision: "rejected", reason });
                }}
              >
                رفض
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => decide.mutate({ institutionId: inst.id, decision: "archived" })}
              >
                أرشفة
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** طلبات تعديل البيانات الحساسة */
export function ChangeRequestsPanel() {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const decideFn = useServerFn(reviewChangeRequest);
  const fetchRequests = useServerFn(listChangeRequests);

  const requests = useQuery<ChangeRequestRow[]>({
    queryKey: ["admin", "change-requests"],
    queryFn: async () => (await fetchRequests()) as ChangeRequestRow[],
  });

  const decide = useMutation({
    mutationFn: (vars: { requestId: string; decision: "approved" | "rejected"; note?: string }) =>
      decideFn({ data: vars }),
    onSuccess: () => {
      toast.success("تم تسجيل القرار");
      queryClient.invalidateQueries({ queryKey: ["admin", "change-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = requests.data ?? [];
  const targetLabel: Record<string, string> = {
    profile: "بيانات مستخدم",
    institution: "بيانات مؤسسة",
    institution_settings: "إعدادات مؤسسة",
  };

  return (
    <section className="card-soft p-4">
      <h2 className="font-display text-lg font-extrabold">طلبات تعديل البيانات</h2>
      <div className="mt-4 space-y-3">
        {list.length === 0 && <EmptyState text="لا توجد طلبات تعديل" />}
        {list.map((r) => (
          <div key={r.id} className="rounded-xl border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{targetLabel[r.target] ?? r.target}</span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                {r.status === "pending" ? "🟡 قيد المراجعة" : r.status === "approved" ? "🟢 مقبول" : "🔴 مرفوض"}
              </span>
              <span className="text-xs text-muted-foreground">{fmt(r.created_at)}</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <pre className="overflow-x-auto rounded-lg bg-secondary p-2 text-[11px]">
                القديم: {JSON.stringify(r.old_values, null, 1)}
              </pre>
              <pre className="overflow-x-auto rounded-lg bg-brand-soft p-2 text-[11px]">
                الجديد: {JSON.stringify(r.new_values, null, 1)}
              </pre>
            </div>
            {r.status === "pending" && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  className="h-9 max-w-xs"
                  placeholder="ملاحظة القرار (اختياري)"
                  value={notes[r.id] ?? ""}
                  onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                />
                <Button
                  size="sm"
                  onClick={() =>
                    decide.mutate({ requestId: r.id, decision: "approved", note: notes[r.id] })
                  }
                >
                  موافقة وتطبيق
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    decide.mutate({ requestId: r.id, decision: "rejected", note: notes[r.id] })
                  }
                >
                  رفض
                </Button>
              </div>
            )}
            {r.decision_note && (
              <p className="mt-2 text-xs text-muted-foreground">ملاحظة المراجع: {r.decision_note}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** سجل التدقيق الأمني والإداري */
export function AuditLogPanel({ institutionId }: { institutionId?: string }) {
  const [q, setQ] = useState("");
  const fetchLogs = useServerFn(listAuditLogsAdmin);
  const logs = useQuery<AuditLogRow[]>({
    queryKey: ["audit-logs", institutionId ?? "all"],
    queryFn: async () => (await fetchLogs({ data: {} })) as AuditLogRow[],
  });

  const list = (logs.data ?? []).filter(
    (l) =>
      !q.trim() ||
      `${l.action} ${l.resource ?? ""} ${l.resource_id ?? ""} ${l.actor_role ?? ""}`
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );

  return (
    <section className="card-soft p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold">سجل التدقيق (Audit Logs)</h2>
        <Input
          className="h-9 max-w-xs"
          placeholder="بحث في السجل…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="mt-4 overflow-x-auto">
        {list.length === 0 ? (
          <EmptyState text="لا توجد أحداث مسجلة بعد" />
        ) : (
          <table className="w-full min-w-[640px] text-start text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-2 text-start">التاريخ</th>
                <th className="p-2 text-start">الحدث</th>
                <th className="p-2 text-start">المورد</th>
                <th className="p-2 text-start">الدور</th>
                <th className="p-2 text-start">النتيجة</th>
              </tr>
            </thead>
            <tbody>
              {list.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="p-2 whitespace-nowrap">{fmt(l.created_at)}</td>
                  <td className="p-2 font-semibold">{l.action}</td>
                  <td className="p-2">
                    {l.resource ?? "—"}
                    {l.resource_id ? ` · ${String(l.resource_id).slice(0, 8)}` : ""}
                  </td>
                  <td className="p-2">{l.actor_role ?? "—"}</td>
                  <td className="p-2">{l.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/** الفواتير والوصولات */
export function InvoicesPanel({
  institutionId,
  allowIssue = false,
}: {
  institutionId?: string;
  allowIssue?: boolean;
}) {
  const queryClient = useQueryClient();
  const issue = useServerFn(issueInvoice);
  const fetchInvoices = useServerFn(listInvoices);
  const fetchIssuablePayments = useServerFn(listIssuablePayments);

  const invoices = useQuery<InvoiceRow[]>({
    queryKey: ["invoices", institutionId ?? "all"],
    queryFn: async () => (await fetchInvoices({ data: institutionId ? { institutionId } : undefined })) as InvoiceRow[],
  });

  const acceptedPayments = useQuery<IssuablePaymentRow[]>({
    enabled: allowIssue,
    queryKey: ["invoices", "issuable"],
    queryFn: async () => (await fetchIssuablePayments()) as IssuablePaymentRow[],
  });

  const create = useMutation({
    mutationFn: (paymentId: string) => issue({ data: { paymentId } }),
    onSuccess: (res: { number?: string }) => {
      toast.success(`تم إصدار الفاتورة ${res?.number ?? ""}`);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const issued = new Set((invoices.data ?? []).map((i) => i.payment_id));

  return (
    <div className="space-y-4">
      {allowIssue && (
        <section className="card-soft p-4">
          <h2 className="font-display text-lg font-extrabold">إصدار فاتورة لدفعة مقبولة</h2>
          <div className="mt-3 space-y-2">
            {(acceptedPayments.data ?? []).filter((p) => !issued.has(p.id)).length === 0 && (
              <EmptyState text="كل الدفعات المقبولة لديها فواتير" />
            )}
            {(acceptedPayments.data ?? [])
              .filter((p) => !issued.has(p.id))
              .map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm"
                >
                  <span>
                    {(p.institutions as { name?: string } | null)?.name ?? "—"} · {p.amount} دج ·{" "}
                    {fmt(p.paid_at)}
                  </span>
                  <Button size="sm" onClick={() => create.mutate(p.id)}>
                    إصدار الفاتورة
                  </Button>
                </div>
              ))}
          </div>
        </section>
      )}

      <section className="card-soft p-4">
        <h2 className="font-display text-lg font-extrabold">الفواتير والوصولات</h2>
        <div className="mt-3 space-y-2">
          {(invoices.data ?? []).length === 0 && <EmptyState text="لا توجد فواتير بعد" />}
          {(invoices.data ?? []).map((inv) => (
            <article key={inv.id} className="rounded-xl border border-border p-3 text-sm print-area">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-display font-bold">فاتورة رقم {inv.number}</span>
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  طباعة / PDF
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {(inv.institutions as { name?: string } | null)?.name ?? "—"} · صدرت في{" "}
                {fmt(inv.issued_at)} · طريقة الدفع: {inv.method.toUpperCase()} · الحالة:{" "}
                {inv.status === "paid"
                  ? "مدفوعة"
                  : inv.status === "issued"
                    ? "صادرة"
                    : inv.status === "pending"
                      ? "قيد الانتظار"
                      : inv.status === "void"
                        ? "ملغاة"
                        : inv.status}
              </p>
              <p className="mt-1 font-semibold">
                المبلغ: {Number(inv.amount).toLocaleString("ar-DZ")} دج — الفترة:{" "}
                {inv.period_start ?? "—"} → {inv.period_end ?? "—"}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
