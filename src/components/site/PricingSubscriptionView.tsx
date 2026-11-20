import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { useAccount } from "@/lib/account";
import { getInstitutionPayments, submitPaymentProof } from "@/lib/payment.functions";
import { uploadMedia } from "@/lib/storage.functions";

const steps = [
  { n: 1, text: "تسجيل المؤسسة" },
  { n: 2, text: "إنشاء طلب الاشتراك السنوي" },
  { n: 3, text: "الدفع عبر CCP (9,000 دج)" },
  { n: 4, text: "رفع وصل الدفع" },
  { n: 5, text: "طلب قيد المراجعة" },
  { n: 6, text: "مدير المنصة يتحقق من الوصل" },
];

type PaymentRecord = {
  id: string;
  status: string;
  amount: number;
  paid_at: string;
};

export function PricingSubscriptionView() {
  const account = useAccount();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [copied, setCopied] = useState(false);
  const [institutionName, setInstitutionName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submitProof = useServerFn(submitPaymentProof);
  const uploadFn = useServerFn(uploadMedia);
  const fetchPayments = useServerFn(getInstitutionPayments);

  const institutionId = account.data?.profile?.institution_id as string | undefined;
  const isInstitutionAdmin = account.data?.role === "institution_admin";
  const defaultInstName = (account.data?.institution as { name?: string } | null | undefined)?.name;

  useEffect(() => {
    if (!institutionName && defaultInstName) {
      setInstitutionName(defaultInstName);
    }
  }, [defaultInstName, institutionName]);

  const existingPayments = useQuery({
    queryKey: ["subscribe", "payments", institutionId],
    enabled: !!institutionId && !!isInstitutionAdmin,
    queryFn: async () => (await fetchPayments()) as PaymentRecord[],
  });

  const pendingPayment = (existingPayments.data ?? []).find((p) => p.status === "pending");

  function copyCcp() {
    navigator.clipboard.writeText("0042451103");
    setCopied(true);
    toast.success("تم نسخ رقم الحساب البريدي CCP");
    setTimeout(() => setCopied(false), 2000);
  }

  function handleFileSelected(selectedFile: File) {
    if (selectedFile.size > 5 * 1024 * 1024) {
      toast.error("حجم الملف يتجاوز الحد الأقصى المسموح (5 ميغابايت)");
      return;
    }
    const validTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!validTypes.includes(selectedFile.type)) {
      toast.error("صيغة الملف غير مدعومة. يرجى اختيار صورة JPG أو PNG أو WEBP أو ملف PDF");
      return;
    }
    if (filePreview) {
      URL.revokeObjectURL(filePreview);
    }
    setFile(selectedFile);
    if (selectedFile.type.startsWith("image/")) {
      setFilePreview(URL.createObjectURL(selectedFile));
    } else {
      setFilePreview(null);
    }
  }

  function removeFile() {
    setFile(null);
    if (filePreview) {
      URL.revokeObjectURL(filePreview);
      setFilePreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!institutionName.trim()) {
        throw new Error("يرجى إدخال اسم المؤسسة.");
      }
      if (!file) {
        throw new Error("يرجى اختيار صورة أو ملف وصل الدفع.");
      }
      if (!account.data?.user || !isInstitutionAdmin || !institutionId) {
        throw new Error("يجب تسجيل الدخول كمدير مؤسسة لرفع وصل الدفع وتفعيله.");
      }

      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          const commaIdx = res.indexOf(",");
          resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_") || "proof";
      const uploadRes = await uploadFn({
        data: {
          bucket: "payment-proofs",
          path: `${institutionId}/${Date.now()}-${safeFileName}`,
          fileBase64: base64Data,
          contentType: file.type || "application/pdf",
        },
      });

      return submitProof({
        data: {
          paidAt: new Date().toISOString().slice(0, 10),
          amount: 9000,
          reference: null,
          institutionName: institutionName.trim(),
          proofPath: uploadRes.path,
        },
      });
    },
    onSuccess: () => {
      setSubmitted(true);
      toast.success("تم إرسال وصل الدفع بنجاح. سيتم التحقق وتفعيل الحساب خلال 24 ساعة.");
      existingPayments.refetch();
    },
    onError: (err: Error) => {
      toast.error(err.message || "تعذّر إرسال وصل الدفع. يرجى المحاولة لاحقًا.");
    },
  });

  return (
    <div className="min-h-screen bg-[#F6F4EF] text-[#14130F] font-sans antialiased" dir="rtl">
      <SiteHeader />

      <main className="mx-auto max-w-[760px] px-4 py-10 sm:px-6 md:py-14 flex flex-col gap-6">
        <div className="flex flex-col items-center text-center gap-2.5">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-[#14130F]">
            سعر بسيط وواضح
          </h1>
          <p className="max-w-[560px] text-base sm:text-lg text-[#4A4943]">
            باقة واحدة تشمل كل شيء. بدون رسوم خفية وبدون حدود على عدد المستخدمين.
          </p>
        </div>

        <section
          id="pricing"
          className="overflow-hidden rounded-[28px] border border-[#E3DFD5] bg-white shadow-[0_24px_48px_-28px_rgba(20,19,15,0.18)]"
        >
          <div className="flex flex-col items-center gap-1.5 bg-[#E4F1EB] px-6 py-7 sm:py-8 text-center">
            <span className="rounded-full bg-[#0B6B4B] px-4 py-1 text-xs font-semibold text-white">
              الباقة الأساسية
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl sm:text-6xl font-extrabold tracking-tight text-[#14130F]">
                9,000
              </span>
              <span className="text-2xl font-bold text-[#14130F]">دج</span>
            </div>
            <span className="text-sm sm:text-base font-medium text-[#3C3B36]">
              اشتراك سنوي لكل مؤسسة
            </span>
          </div>

          <div className="p-5 sm:p-6 flex flex-wrap gap-3">
            <Link
              to="/register"
              preload="intent"
              className="flex-1 min-w-[220px] h-[52px] rounded-xl bg-[#0B6B4B] px-6 text-sm sm:text-base font-semibold text-white flex items-center justify-center transition hover:bg-[#09573c]"
            >
              تسجيل مؤسسة والاشتراك
            </Link>
            <a
              href="#payment"
              className="flex-1 min-w-[220px] h-[52px] rounded-xl border border-[#CFCABD] bg-white px-6 text-sm sm:text-base font-semibold text-[#14130F] flex items-center justify-center transition hover:bg-[#F6F4EF]"
            >
              طريقة الدفع ورفع الوصل
            </a>
          </div>
        </section>

        <section className="rounded-[20px] border border-[#E3DFD5] bg-white p-5 sm:p-7 flex flex-col gap-3 shadow-sm">
          <h2 className="text-xl sm:text-2xl font-bold text-[#14130F]">
            ماذا يحدث عند انتهاء الاشتراك؟
          </h2>
          <ul className="space-y-2.5 text-sm sm:text-base leading-7 text-[#3C3B36]">
            <li className="flex items-start gap-2">
              <span className="text-[#0B6B4B] font-bold">•</span>
              <span>تنبيه قبل 30 يومًا من انتهاء الاشتراك.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0B6B4B] font-bold">•</span>
              <span>تنبيه ثانٍ قبل 7 أيام.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0B6B4B] font-bold">•</span>
              <span>
                عند الانتهاء يتم إيقاف الحساب مؤقتًا فقط،{" "}
                <strong className="text-[#14130F]">ولا تُحذف أي بيانات.</strong>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#0B6B4B] font-bold">•</span>
              <span>بمجرد التجديد تعود المؤسسة لاستعمال المنصة بكامل بياناتها.</span>
            </li>
          </ul>
        </section>

        <div id="payment" className="flex flex-col gap-1.5 pt-2 scroll-mt-20">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#14130F]">
            الاشتراك السنوي والدفع
          </h2>
          <p className="text-base sm:text-lg text-[#4A4943]">
            الدفع يتم حاليًا عبر الحساب البريدي CCP مع تحقق يدوي من إدارة المنصة.
          </p>
        </div>

        {(!institutionId || !isInstitutionAdmin) && (
          <div className="rounded-[18px] bg-[#E4F1EB] px-5 py-4 text-sm sm:text-base font-medium text-[#0B6B4B] leading-6">
            يجب تسجيل الدخول كمدير مؤسسة لرفع وصل الدفع:{" "}
            <Link to="/auth" preload="intent" className="font-bold underline hover:text-[#09573c]">
              تسجيل الدخول
            </Link>{" "}
            أو{" "}
            <Link to="/register" preload="intent" className="font-bold underline hover:text-[#09573c]">
              تسجيل مؤسسة جديدة
            </Link>
          </div>
        )}

        <section className="rounded-[20px] border border-[#E3DFD5] bg-white p-5 sm:p-7 flex flex-col gap-4 shadow-sm">
          <h2 className="text-xl sm:text-2xl font-bold text-[#14130F]">مسار الاشتراك</h2>
          <div className="flex flex-col gap-2.5">
            {steps.map((s) => (
              <div key={s.n} className="flex items-center gap-3.5 text-sm sm:text-base text-[#14130F]">
                <b className="h-7 w-7 rounded-full bg-[#14130F] text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {s.n}
                </b>
                <span>{s.text}</span>
              </div>
            ))}
          </div>

          <div className="h-px bg-[#E3DFD5] my-1" />

          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[120px] h-11 rounded-xl border border-[#CFCABD] bg-[#F6F4EF] flex items-center justify-center text-sm font-semibold text-[#14130F]">
              قبول
            </div>
            <div className="flex-1 min-w-[120px] h-11 rounded-xl border border-[#CFCABD] bg-[#F6F4EF] flex items-center justify-center text-sm font-semibold text-[#14130F]">
              رفض
            </div>
            <div className="flex-1 min-w-[120px] h-11 rounded-xl border border-[#CFCABD] bg-[#F6F4EF] flex items-center justify-center text-sm font-semibold text-[#14130F]">
              موقوف
            </div>
          </div>
        </section>

        <section className="rounded-[20px] border border-[#E3DFD5] bg-white p-5 sm:p-7 flex flex-col gap-4 shadow-sm">
          <h2 className="text-xl sm:text-2xl font-bold text-[#14130F]">معلومات الدفع</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 items-start">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[#5B5A55]">الاسم واللقب المستفيد</span>
              <strong className="text-lg font-bold text-[#14130F]">ishak diaf</strong>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-[#5B5A55]">N° CCP رقم الحساب البريدي</span>
              <strong className="font-mono text-xl font-bold text-[#14130F]" dir="ltr">
                0042451103
              </strong>
              <button
                type="button"
                onClick={copyCcp}
                className="w-fit rounded-lg border border-[#CFCABD] bg-white px-3 py-1 text-xs font-medium text-[#14130F] flex items-center gap-1.5 transition hover:bg-[#F6F4EF]"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#0B6B4B]" />
                    <span>تم النسخ</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>نسخ الرقم</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-[#5B5A55]">Clé المفتاح</span>
              <strong className="font-mono text-xl font-bold text-[#14130F]">65</strong>
            </div>
          </div>
        </section>

        <section className="rounded-[20px] border border-[#E3DFD5] border-r-4 border-r-[#0B6B4B] bg-white p-5 sm:p-7 flex flex-col gap-1.5 shadow-sm">
          <h2 className="text-lg font-bold text-[#14130F]">تنبيه هام للمديرين</h2>
          <p className="text-sm sm:text-base leading-6 text-[#4A4943]">
            بعد إتمام عملية الدفع (Versement) لدى مكتب البريد، يرجى كتابة اسم مؤسستكم على الوصل، ثم
            التقاط صورة واضحة له ورفعها في المكان المخصص أسفله لتأكيد المعاملة وتفعيل حسابكم في غضون
            24 ساعة.
          </p>
        </section>

        {pendingPayment && (
          <div className="rounded-[20px] border border-[#CFE3D9] bg-[#E4F1EB] p-6 text-center flex flex-col items-center gap-2">
            <Clock className="h-10 w-10 text-[#0B6B4B] animate-pulse" />
            <h3 className="text-lg font-bold text-[#14130F]">طلبك قيد المراجعة حاليًا</h3>
            <p className="text-sm text-[#4A4943] max-w-md">
              تم إرسال وصل الدفع بمبلغ 9,000 دج وهو بانتظار تأكيد إدارة المنصة. سيتم تفعيل حسابك
              مباشرة عند القبول.
            </p>
          </div>
        )}

        <section
          id="upload"
          className="rounded-[20px] border-2 border-[#0B6B4B] bg-white p-5 sm:p-7 flex flex-col gap-3.5 shadow-sm"
        >
          <h2 className="text-xl sm:text-2xl font-bold text-[#14130F]">رفع إثبات الدفع</h2>

          {submitted ? (
            <div className="rounded-xl border border-[#CFE3D9] bg-[#E4F1EB] p-6 text-center flex flex-col items-center gap-2">
              <CheckCircle2 className="h-10 w-10 text-[#0B6B4B]" />
              <h3 className="text-lg font-bold text-[#14130F]">تم استلام وصل الدفع بنجاح</h3>
              <p className="text-sm text-[#4A4943] max-w-md">
                وصلك قيد المراجعة لدى إدارة المنصة وسيتم تفعيل حساب مؤسستك وإرسال إشعار لك خلال 24
                ساعة.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSubmitted(false);
                  removeFile();
                }}
                className="mt-3 text-xs font-semibold text-[#0B6B4B] underline"
              >
                رفع وصل آخر
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="institution" className="text-sm font-semibold text-[#14130F]">
                  اسم المؤسسة
                </label>
                <input
                  id="institution"
                  name="institution"
                  type="text"
                  required
                  placeholder="مثال: مدرسة النجاح"
                  value={institutionName}
                  onChange={(e) => setInstitutionName(e.target.value)}
                  className="h-12 w-full rounded-xl border border-[#CFCABD] bg-white px-4 text-sm text-[#14130F] outline-none transition focus:border-[#0B6B4B] focus:ring-2 focus:ring-[#0B6B4B]/20"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-[#14130F]">وصل الدفع</label>

                {!file ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      if (e.dataTransfer.files?.[0]) {
                        handleFileSelected(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`rounded-2xl border-2 border-dashed p-7 flex flex-col items-center justify-center gap-2 cursor-pointer transition ${
                      isDragging
                        ? "border-[#0B6B4B] bg-[#E4F1EB]"
                        : "border-[#CFCABD] bg-[#F6F4EF]/60 hover:border-[#0B6B4B] hover:bg-[#F6F4EF]"
                    }`}
                  >
                    <Upload className="h-7 w-7 text-[#0B6B4B]" />
                    <strong className="text-sm sm:text-base font-bold text-[#14130F]">
                      اضغط لاختيار الملف أو اسحبه وأفلته هنا
                    </strong>
                    <span className="text-xs text-[#5B5A55]">
                      JPG أو PNG أو WEBP أو PDF — الحد الأقصى 5 ميغابايت
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          handleFileSelected(e.target.files[0]);
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#E3DFD5] bg-[#F6F4EF] p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {filePreview ? (
                        <img
                          src={filePreview}
                          alt="معاينة الوصل"
                          className="h-14 w-14 rounded-lg object-cover border border-[#CFCABD]"
                        />
                      ) : (
                        <div className="h-14 w-14 rounded-lg bg-red-100 text-red-700 font-bold flex items-center justify-center text-sm border border-red-200">
                          <FileText className="h-6 w-6" />
                        </div>
                      )}
                      <div className="flex flex-col min-w-0">
                        <strong className="text-sm font-bold text-[#14130F] truncate">
                          {file.name}
                        </strong>
                        <span className="text-xs text-[#5B5A55]">
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={removeFile}
                      className="rounded-lg border border-[#CFCABD] bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-1"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>إزالة</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={mutation.isPending}
                className="h-[52px] w-full rounded-xl bg-[#0B6B4B] text-base font-semibold text-white shadow-sm flex items-center justify-center gap-2 transition hover:bg-[#09573c] disabled:opacity-50"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>جارٍ رفع الوصل...</span>
                  </>
                ) : (
                  <span>إرسال الوصل للمراجعة</span>
                )}
              </button>
            </form>
          )}
        </section>

        <section className="rounded-[20px] border border-[#E3DFD5] bg-white p-5 sm:p-7 flex flex-col gap-1.5 shadow-sm">
          <h2 className="text-xl sm:text-2xl font-bold text-[#14130F]">نظام التجديد</h2>
          <p className="text-sm sm:text-base leading-6 text-[#4A4943]">
            يتم التجديد بنفس خطوات الاشتراك: الدفع عبر CCP، ثم رفع الإثبات، ثم مراجعة الإدارة وتجديد
            سنة جديدة.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
