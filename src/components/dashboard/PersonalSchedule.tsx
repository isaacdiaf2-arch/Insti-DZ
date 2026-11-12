import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/dashboard/DashboardShell";
import { DAYS, hhmm } from "@/lib/schedule";
import {
  getPersonalSchedule,
  addPersonalScheduleEntry,
  deletePersonalScheduleEntry,
} from "@/lib/curriculum.functions";

/** Personal timetable owned by the signed-in user (teacher or student). */
export function PersonalSchedule({ userId, institutionId }: { userId?: string; institutionId?: string }) {
  const qc = useQueryClient();
  const key = ["personal-schedule", userId];
  const [form, setForm] = useState({ day: "0", start: "08:00", end: "09:00", title: "", note: "" });
  const [saving, setSaving] = useState(false);

  const fetchSchedule = useServerFn(getPersonalSchedule);
  const addEntry = useServerFn(addPersonalScheduleEntry);
  const deleteEntry = useServerFn(deletePersonalScheduleEntry);

  const list = useQuery({
    queryKey: key,
    enabled: !!userId,
    queryFn: async () => {
      return (await fetchSchedule()) as any[];
    },
  });

  const rows = list.data ?? [];
  const days = Array.from(new Set(rows.map((r) => r.day_of_week))).sort();

  return (
    <section className="space-y-3">
      <form
        className="card-soft space-y-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (form.end && form.end <= form.start) return toast.error("وقت النهاية يجب أن يكون بعد البداية.");
          setSaving(true);
          try {
            await addEntry({
              data: {
                institutionId: institutionId ?? null,
                dayOfWeek: Number(form.day),
                startTime: form.start,
                endTime: form.end || null,
                title: form.title.trim(),
                note: form.note.trim() || null,
              },
            });
            toast.success("أُضيفت الحصة إلى جدولك.");
            setForm({ ...form, title: "", note: "" });
            qc.invalidateQueries({ queryKey: key });
          } catch (err: any) {
            toast.error(err.message || "تعذر إضافة الحصة.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <h2 className="text-lg">+ إنشاء جدولي الخاص</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-2">
            <Label>اليوم</Label>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={form.day}
              onChange={(e) => setForm({ ...form, day: e.target.value })}
            >
              {DAYS.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label>من</Label>
            <Input type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label>إلى</Label>
            <Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label>المادة / النشاط</Label>
            <Input required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>ملاحظة (اختياري)</Label>
          <Input maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <Button type="submit" disabled={saving || !userId} className="w-full sm:w-auto">إضافة إلى الجدول</Button>
      </form>

      {rows.length === 0 && <EmptyState text="لم تضف أي حصة إلى جدولك الخاص بعد." />}
      {days.map((d) => (
        <div key={d} className="card-soft p-3">
          <p className="font-display font-extrabold">{DAYS[d]}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rows.filter((r) => r.day_of_week === d).map((r) => (
              <div key={r.id} className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-mono text-xs">{hhmm(r.start_time)}{r.end_time ? ` - ${hhmm(r.end_time)}` : ""}</p>
                  <p className="mt-1 break-words font-semibold">{r.title}</p>
                  {r.note && <p className="mt-0.5 break-words text-xs text-muted-foreground">{r.note}</p>}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="ms-auto shrink-0"
                  aria-label="حذف"
                  onClick={async () => {
                    try {
                      await deleteEntry({ data: { id: r.id } });
                      qc.invalidateQueries({ queryKey: key });
                    } catch (err: any) {
                      toast.error(err.message || "تعذر الحذف.");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
