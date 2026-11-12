import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Send, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { submitSupportMessage } from "@/lib/inbound.functions";
import { supportMessageSchema } from "@/lib/inbound.shared";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "التواصل والدعم | Insti DZ" },
      {
        name: "description",
        content:
          "تواصل مع فريق Insti DZ: أرسل معلومات مؤسستك واستفسارك أو طلب التجربة وسيصلك الرد على البريد الإلكتروني في أقرب وقت.",
      },
      { property: "og:title", content: "التواصل والدعم | Insti DZ" },
      {
        property: "og:description",
        content: "أرسل استفسارك أو طلب تجربة المنصة لفريق Insti DZ.",
      },
    ],
  }),
  component: Contact,
});

function Contact() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = useServerFn(submitSupportMessage);

  const mutation = useMutation({
    mutationFn: send,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      setError(null);
      setSent(true);
      toast.success("تم استلام رسالتك بنجاح");
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.error("تعذّر إرسال الرسالة");
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "").trim();
    const parsed = supportMessageSchema.safeParse({
      firstName: get("firstName"),
      lastName: get("lastName"),
      institutionName: get("institution"),
      wilaya: get("wilaya"),
      commune: get("commune"),
      address: get("address"),
      phone: get("phones"),
      email: get("email"),
      message: get("message"),
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "تحقق من البيانات المدخلة";
      setError(msg);
      toast.error(msg);
      return;
    }
    mutation.mutate({ data: parsed.data });
  }

  return (
    <div className="min-h-screen bg-[#F6F4EF] text-[#14130F] font-sans antialiased" dir="rtl">
      <SiteHeader />

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 md:py-16">
        <div className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-[#14130F] sm:text-5xl">
            التواصل والدعم
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-[#4A4943] sm:text-lg">
            املأ المعلومات التالية وسيتم إرسالها مباشرة إلى فريق الدعم داخل المنصة، وسيصلك الرد على
            بريدك الإلكتروني في أقرب وقت.
          </p>
        </div>

        {sent ? (
          <div className="mt-8 rounded-[24px] border border-[#E3DFD5] bg-white p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto h-12 w-12 text-[#0B6B4B]" />
            <h2 className="mt-4 text-2xl font-bold text-[#14130F]">تم استلام رسالتك بنجاح</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[#4A4943]">
              وصلت رسالتك إلى فريق الدعم داخل المنصة وسيتم الرد عليك على بريدك الإلكتروني في أقرب وقت.
            </p>
            <button
              type="button"
              className="mt-6 rounded-xl border border-[#CFCABD] bg-white px-6 py-2.5 text-sm font-semibold text-[#14130F] hover:bg-[#F6F4EF]"
              onClick={() => setSent(false)}
            >
              إرسال رسالة أخرى
            </button>
          </div>
        ) : (
          <form
            className="mt-8 space-y-5 rounded-[24px] border border-[#E3DFD5] bg-white p-6 shadow-sm sm:p-8"
            onSubmit={handleSubmit}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="firstName" label="الاسم" required />
              <TextField name="lastName" label="اللقب" required />
              <div className="sm:col-span-2">
                <TextField name="institution" label="اسم المؤسسة" required />
              </div>
              <TextField name="wilaya" label="الولاية" required />
              <TextField name="commune" label="البلدية" required />
              <div className="sm:col-span-2">
                <TextField name="address" label="عنوان المؤسسة" required />
              </div>
              <TextField name="phones" label="رقم الهاتف" type="tel" dir="ltr" placeholder="05XXXXXXXX" required />
              <TextField name="email" label="البريد الإلكتروني" type="email" dir="ltr" placeholder="email@example.com" required />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="message" className="text-sm font-medium text-[#14130F]">
                رسالتك <span className="text-[#0B6B4B]">*</span>
              </label>
              <textarea
                id="message"
                name="message"
                rows={5}
                maxLength={2000}
                required
                placeholder="اكتب استفسارك أو طلب التجربة هنا..."
                className="w-full rounded-xl border border-[#CFCABD] bg-white p-3 text-sm text-[#14130F] outline-none transition focus:border-[#0B6B4B] focus:ring-2 focus:ring-[#0B6B4B]/20"
              />
            </div>

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0B6B4B] text-sm font-semibold text-white shadow-sm transition hover:bg-[#09573c] disabled:opacity-50"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span>إرسال الرسالة</span>
            </button>
          </form>
        )}

        <div className="mt-8 flex items-center justify-center gap-2 rounded-xl border border-[#CFE3D9] bg-[#E4F1EB] p-4 text-xs font-medium text-[#0B6B4B]">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>جميع الطلبات والاستفسارات تُعالج حصريًا داخل المنصة لضمان أمان وتوثيق كل طلب.</span>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function TextField({
  name,
  label,
  type = "text",
  required,
  dir,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  dir?: "ltr" | "rtl";
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium text-[#14130F]">
        {label} {required && <span className="text-[#0B6B4B]">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        dir={dir}
        placeholder={placeholder}
        maxLength={200}
        className="h-11 w-full rounded-xl border border-[#CFCABD] bg-white px-3.5 text-sm text-[#14130F] outline-none transition focus:border-[#0B6B4B] focus:ring-2 focus:ring-[#0B6B4B]/20"
      />
    </div>
  );
}
