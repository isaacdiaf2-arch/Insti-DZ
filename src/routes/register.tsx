import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  registerInstitutionAccount,
  saveInstitutionMedia,
} from "@/lib/signup.functions";
import { loginWithCredentials } from "@/lib/auth.functions";
import { uploadMedia as uploadMediaServerFn } from "@/lib/storage.functions";
import {
  INSTITUTION_TYPES,
  institutionSignupSchema,
  type InstitutionSignupInput,
} from "@/lib/signup.shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "تسجيل مؤسسة جديدة | Study DZ" },
      {
        name: "description",
        content:
          "سجّل مؤسستك التعليمية في Study DZ: بيانات المؤسسة الكاملة، الشعار والغلاف، رقم الاعتماد والسجل التجاري، ثم ادفع عبر CCP ليتم التفعيل خلال 24 ساعة.",
      },
      { property: "og:title", content: "تسجيل مؤسسة جديدة | Study DZ" },
      {
        property: "og:description",
        content: "أنشئ حساب مؤسستك التعليمية على منصة Study DZ في دقائق.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegisterPage,
});

const emptyForm: InstitutionSignupInput = {
  name: "",
  nameFr: "",
  type: "",
  accreditationNumber: "",
  commercialRegister: "",
  accreditationAuthority: "",
  foundedOn: "",
  wilaya: "",
  commune: "",
  daira: "",
  address: "",
  mapsUrl: "",
  phone: "",
  email: "",
  website: "",
  facebookUrl: "",
  instagramUrl: "",
  firstName: "",
  lastName: "",
  managerPhone: "",
  managerEmail: "",
  password: "",
  confirmPassword: "",
};

function RegisterPage() {
  const navigate = useNavigate();
  const register = useServerFn(registerInstitutionAccount);
  const saveMedia = useServerFn(saveInstitutionMedia);
  const login = useServerFn(loginWithCredentials);

  const [form, setForm] = useState<InstitutionSignupInput>(emptyForm);
  const [logo, setLogo] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function set<K extends keyof InstitutionSignupInput>(key: K, value: InstitutionSignupInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key as string]) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  }

  async function uploadMedia(institutionId: string) {
    const payload: { logoUrl?: string; coverUrl?: string } = {};
    const items: [File | null, "logo" | "cover"][] = [
      [logo, "logo"],
      [cover, "cover"],
    ];
    for (const [file, kind] of items) {
      if (!file) continue;
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `${institutionId}/${kind}-${Date.now()}.${ext}`;

      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.includes(",") ? result.split(",")[1] : result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const uploadRes = await uploadMediaServerFn({
          data: {
            bucket: "institution-media",
            path,
            fileBase64: base64,
            contentType: file.type || (kind === "logo" ? "image/png" : "image/jpeg"),
          },
        });

        if (uploadRes?.url) {
          if (kind === "logo") payload.logoUrl = uploadRes.url;
          else payload.coverUrl = uploadRes.url;
          continue;
        }
      } catch (err) {
        console.warn("[Register Media Upload] Backend storage upload failed:", err);
      }
    }
    if (payload.logoUrl || payload.coverUrl) {
      await saveMedia({ data: payload });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = institutionSignupSchema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      toast.error("يرجى تصحيح الحقول المطلوبة.");
      return;
    }

    setBusy(true);
    try {
      const { institutionId } = await register({ data: form });

      try {
        const loginRes = await login({
          data: {
            email: form.managerEmail.trim().toLowerCase(),
            password: form.password,
          },
        });
        const token = (loginRes as any)?.token || (loginRes as any)?.session?.token;
        if (token) {
          localStorage.setItem("sdz_session_token", token);
          localStorage.setItem("sdz_auth_token", token);
          document.cookie = `sdz_session_token=${encodeURIComponent(token)}; path=/; max-age=604800; SameSite=Lax`;
          try {
            await uploadMedia(institutionId);
          } catch {
            toast.warning("تم إنشاء الحساب، لكن تعذّر رفع الصور. يمكنك رفعها لاحقًا من لوحة المؤسسة.");
          }
        }
      } catch (loginErr) {
        console.warn("[Register] Auto-login error:", loginErr);
      }

      setDone(true);
      toast.success("تم إنشاء حساب مؤسستك بنجاح.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر إنشاء الحساب.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F4EF] text-[#14130F]" dir="rtl">
      <SiteHeader />
      <main className="mx-auto flex max-w-[920px] flex-col gap-7 px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-2.5">
          <h1 className="text-3xl font-bold tracking-tight text-[#14130F] sm:text-4xl lg:text-[44px]">
            تسجيل مؤسسة جديدة
          </h1>
          <p className="max-w-[720px] text-base leading-relaxed text-[#4A4943] sm:text-[17px]">
            املأ المعلومات التالية لإنشاء حساب مؤسستك. البريد الإلكتروني ورقم الهاتف إجباريان، ولا يمكن استعمال بريد أو رقم مسجّل مسبقًا في المنصة.
          </p>
        </div>

        {done ? (
          <div className="rounded-[26px] border border-[#E3DFD5] bg-white p-8 text-center shadow-sm sm:p-12">
            <CheckCircle2 className="mx-auto h-14 w-14 text-[#0B6B4B]" />
            <h2 className="mt-4 text-2xl font-bold text-[#14130F]">حسابك قيد المراجعة</h2>
            <ol className="mx-auto mt-6 max-w-md space-y-2.5 text-start text-sm leading-7 text-[#4A4943]">
              <li>1. اختر الباقة (9,000 دج سنويًا).</li>
              <li>2. قم بالدفع عبر الحساب البريدي CCP.</li>
              <li>3. أرسل إثبات الدفع (صورة أو PDF).</li>
              <li>4. انتظر التفعيل بعد التحقق اليدوي من الإدارة خلال 24 ساعة.</li>
            </ol>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-xl bg-[#0B6B4B] text-white hover:bg-[#09573c]">
                <Link to="/subscribe" preload="intent">الانتقال إلى صفحة الاشتراك والدفع</Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="rounded-xl border-[#CFCABD] bg-white text-[#14130F]"
                onClick={() => navigate({ to: "/institution" })}
              >
                الدخول إلى لوحة المؤسسة
              </Button>
            </div>
          </div>
        ) : (
          <form className="flex flex-col gap-6" onSubmit={handleSubmit} noValidate>
            {/* Section 1: معلومات المؤسسة */}
            <section className="flex flex-col gap-6 rounded-[26px] border border-[#E3DFD5] bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-[22px] font-bold text-[#14130F]">معلومات المؤسسة</h2>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
                <Field
                  id="name"
                  label="اسم المؤسسة (بالعربية)"
                  required
                  value={form.name}
                  onChange={(v) => set("name", v)}
                  error={errors["name"]}
                />
                <Field
                  id="nameFr"
                  label="اسم المؤسسة (بالفرنسية) – اختياري"
                  dir="ltr"
                  value={form.nameFr ?? ""}
                  onChange={(v) => set("nameFr", v)}
                  error={errors["nameFr"]}
                />
                <div className="flex flex-col">
                  <label htmlFor="type" className="mb-2 block text-sm font-semibold text-[#14130F]">
                    نوع المؤسسة
                  </label>
                  <select
                    id="type"
                    value={form.type}
                    onChange={(e) => set("type", e.target.value)}
                    className="min-h-[48px] w-full rounded-xl border border-[#CFCABD] bg-white px-3.5 text-[15px] text-[#14130F] outline-none transition focus:border-[#0B6B4B] focus:ring-1 focus:ring-[#0B6B4B]"
                  >
                    <option value="">اختر النوع...</option>
                    {INSTITUTION_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {errors["type"] && <ErrorText>{errors["type"]}</ErrorText>}
                </div>
                <Field
                  id="foundedOn"
                  label="تاريخ التأسيس – اختياري"
                  type="date"
                  dir="ltr"
                  value={form.foundedOn ?? ""}
                  onChange={(v) => set("foundedOn", v)}
                  error={errors["foundedOn"]}
                />
                <Field
                  id="accreditationNumber"
                  label="رقم الاعتماد"
                  required
                  dir="ltr"
                  value={form.accreditationNumber ?? ""}
                  onChange={(v) => set("accreditationNumber", v)}
                  error={errors["accreditationNumber"]}
                />
                <Field
                  id="accreditationAuthority"
                  label="جهة الاعتماد"
                  required
                  value={form.accreditationAuthority ?? ""}
                  onChange={(v) => set("accreditationAuthority", v)}
                  error={errors["accreditationAuthority"]}
                />
                <Field
                  id="commercialRegister"
                  label="رقم السجل التجاري"
                  required
                  dir="ltr"
                  value={form.commercialRegister ?? ""}
                  onChange={(v) => set("commercialRegister", v)}
                  error={errors["commercialRegister"]}
                />
                <FileField
                  id="logo"
                  label="شعار المؤسسة – اختياري"
                  file={logo}
                  onFile={setLogo}
                />
                <div className="sm:col-span-2">
                  <FileField
                    id="cover"
                    label="صورة الغلاف – اختياري"
                    file={cover}
                    onFile={setCover}
                  />
                </div>
              </div>
            </section>

            {/* Section 2: الموقع ومعلومات التواصل */}
            <section className="flex flex-col gap-6 rounded-[26px] border border-[#E3DFD5] bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-[22px] font-bold text-[#14130F]">الموقع ومعلومات التواصل</h2>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
                <Field
                  id="wilaya"
                  label="الولاية"
                  required
                  value={form.wilaya}
                  onChange={(v) => set("wilaya", v)}
                  error={errors["wilaya"]}
                />
                <Field
                  id="daira"
                  label="الدائرة"
                  required
                  value={form.daira ?? ""}
                  onChange={(v) => set("daira", v)}
                  error={errors["daira"]}
                />
                <Field
                  id="commune"
                  label="البلدية"
                  required
                  value={form.commune}
                  onChange={(v) => set("commune", v)}
                  error={errors["commune"]}
                />
                <Field
                  id="address"
                  label="العنوان"
                  required
                  value={form.address}
                  onChange={(v) => set("address", v)}
                  error={errors["address"]}
                />
                <div className="sm:col-span-2">
                  <Field
                    id="mapsUrl"
                    label="رابط Google Maps – اختياري"
                    dir="ltr"
                    placeholder="https://maps.google.com/..."
                    value={form.mapsUrl ?? ""}
                    onChange={(v) => set("mapsUrl", v)}
                    error={errors["mapsUrl"]}
                  />
                </div>
                <Field
                  id="phone"
                  label="رقم هاتف المؤسسة"
                  type="tel"
                  dir="ltr"
                  required
                  placeholder="05XXXXXXXX"
                  value={form.phone}
                  onChange={(v) => set("phone", v)}
                  error={errors["phone"]}
                />
                <Field
                  id="email"
                  label="البريد الإلكتروني للمؤسسة"
                  type="email"
                  dir="ltr"
                  required
                  value={form.email}
                  onChange={(v) => set("email", v)}
                  error={errors["email"]}
                />
                <Field
                  id="website"
                  label="الموقع الإلكتروني – اختياري"
                  dir="ltr"
                  placeholder="https://..."
                  value={form.website ?? ""}
                  onChange={(v) => set("website", v)}
                  error={errors["website"]}
                />
                <Field
                  id="facebookUrl"
                  label="صفحة فيسبوك – اختياري"
                  dir="ltr"
                  placeholder="https://facebook.com/..."
                  value={form.facebookUrl ?? ""}
                  onChange={(v) => set("facebookUrl", v)}
                  error={errors["facebookUrl"]}
                />
                <div className="sm:col-span-2">
                  <Field
                    id="instagramUrl"
                    label="حساب إنستغرام – اختياري"
                    dir="ltr"
                    placeholder="https://instagram.com/..."
                    value={form.instagramUrl ?? ""}
                    onChange={(v) => set("instagramUrl", v)}
                    error={errors["instagramUrl"]}
                  />
                </div>
              </div>
            </section>

            {/* Section 3: معلومات المدير */}
            <section className="flex flex-col gap-6 rounded-[26px] border border-[#E3DFD5] bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-[22px] font-bold text-[#14130F]">معلومات المدير</h2>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
                <Field
                  id="firstName"
                  label="الاسم"
                  required
                  value={form.firstName}
                  onChange={(v) => set("firstName", v)}
                  error={errors["firstName"]}
                />
                <Field
                  id="lastName"
                  label="اللقب"
                  required
                  value={form.lastName}
                  onChange={(v) => set("lastName", v)}
                  error={errors["lastName"]}
                />
                <Field
                  id="managerPhone"
                  label="رقم الهاتف"
                  type="tel"
                  dir="ltr"
                  required
                  placeholder="05XXXXXXXX"
                  value={form.managerPhone}
                  onChange={(v) => set("managerPhone", v)}
                  error={errors["managerPhone"]}
                />
                <Field
                  id="managerEmail"
                  label="البريد الإلكتروني (للدخول)"
                  type="email"
                  dir="ltr"
                  required
                  value={form.managerEmail}
                  onChange={(v) => set("managerEmail", v)}
                  error={errors["managerEmail"]}
                />
                <Field
                  id="password"
                  label="كلمة المرور"
                  type="password"
                  dir="ltr"
                  required
                  value={form.password}
                  onChange={(v) => set("password", v)}
                  error={errors["password"]}
                />
                <Field
                  id="confirmPassword"
                  label="تأكيد كلمة المرور"
                  type="password"
                  dir="ltr"
                  required
                  value={form.confirmPassword}
                  onChange={(v) => set("confirmPassword", v)}
                  error={errors["confirmPassword"]}
                />
              </div>

              {/* Alert notice box */}
              <div className="flex items-start gap-3 rounded-2xl bg-[#E4F1EB] p-4 text-sm text-[#2B2A26]">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0B6B4B"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v5M12 8h.01" />
                </svg>
                <span className="leading-relaxed">
                  لا يمكن فتح أكثر من حساب مؤسسة بنفس البريد الإلكتروني أو رقم الهاتف. ستستعمل بريد المدير وكلمة المرور لتسجيل الدخول إلى لوحة التحكم مباشرة.
                </span>
              </div>
            </section>

            <button
              type="submit"
              disabled={busy}
              className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-[#0B6B4B] text-[17px] font-semibold text-white shadow-sm transition hover:bg-[#09573c] disabled:opacity-60 cursor-pointer"
            >
              {busy ? (
                <>
                  <Loader2 className="me-2 h-5 w-5 animate-spin" />
                  <span>جارٍ إنشاء الحساب…</span>
                </>
              ) : (
                "إنشاء حساب المؤسسة"
              )}
            </button>

            <p className="text-center text-sm text-[#4A4943]">
              لديك حساب بالفعل؟{" "}
              <Link to="/auth" preload="intent" className="font-bold text-[#0B6B4B] underline underline-offset-4">
                تسجيل الدخول
              </Link>
            </p>
          </form>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 text-xs text-destructive">{children}</span>;
}

function Field({
  id,
  label,
  type = "text",
  required,
  dir,
  value,
  onChange,
  error,
  placeholder,
}: {
  id: string;
  label: string;
  type?: string;
  required?: boolean;
  dir?: "ltr" | "rtl";
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-[#14130F]">
        {label}
        {required && <span className="text-[#DC2626] font-bold"> *</span>}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        dir={dir}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        className="w-full min-h-[48px] rounded-xl border border-[#CFCABD] bg-white px-3.5 text-[15px] text-[#14130F] outline-none transition focus:border-[#0B6B4B] focus:ring-1 focus:ring-[#0B6B4B]"
      />
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}

function FileField({
  id,
  label,
  file,
  onFile,
}: {
  id: string;
  label: string;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-[#14130F]">
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept="image/*"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        className="w-full min-h-[48px] rounded-xl border border-[#CFCABD] bg-white p-2.5 text-[14px] text-[#14130F] outline-none transition focus:border-[#0B6B4B] focus:ring-1 focus:ring-[#0B6B4B] file:mr-2 file:rounded-lg file:border-0 file:bg-[#F6F4EF] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#14130F] hover:file:bg-[#E3DFD5]"
      />
      {file && (
        <span className="mt-1 truncate text-xs text-[#4A4943]">{file.name}</span>
      )}
    </div>
  );
}
