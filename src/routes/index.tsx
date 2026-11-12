import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Insti DZ — نظام رقمي لإدارة المؤسسات التعليمية والتكوينية في الجزائر" },
      {
        name: "description",
        content:
          "منصة سحابية تجمع إدارة المؤسسة والتعليم والتعلّم والمتابعة في مكان واحد، باشتراك سنوي واحد وبدون حدود للأساتذة والطلاب.",
      },
      { property: "og:title", content: "Insti DZ — نظام رقمي لإدارة المؤسسات التعليمية والتكوينية في الجزائر" },
      {
        property: "og:description",
        content:
          "منصة سحابية تجمع إدارة المؤسسة والتعليم والتعلّم والمتابعة في مكان واحد، باشتراك سنوي واحد وبدون حدود للأساتذة والطلاب.",
      },
    ],
  }),
  component: Home,
});

export function Home() {
  return (
    <div className="min-h-screen bg-[#F6F4EF] text-[#14130F]" dir="rtl">
      <SiteHeader />

      {/* Hero Section */}
      <section id="top" className="py-16 sm:py-20 lg:py-24">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center px-4 text-center sm:px-6">
          {/* Pill Badge */}
          <span className="inline-block rounded-full bg-[#E4F1EB] px-3.5 py-1.5 text-sm font-semibold text-[#0B6B4B]">
            للمؤسسات التعليمية والتكوينية الخاصة
          </span>

          {/* Heading */}
          <h1 className="mt-6 max-w-4xl text-[34px] font-bold leading-[1.25] tracking-tight text-[#14130F] sm:text-[46px] lg:text-[56px]">
            نظام رقمي واحد لإدارة{" "}
            <span className="text-[#0B6B4B]">
              مؤسستك التعليمية{" "}
              <span className="text-[#14130F]">و</span>التكوينية
            </span>{" "}
            في الجزائر
          </h1>

          {/* Subtitle */}
          <p className="mx-auto mt-6 max-w-[560px] text-lg leading-relaxed text-[#4A4943] sm:text-[19px]">
            منصة سحابية تجمع إدارة المؤسسة والتعليم والتعلّم والمتابعة في مكان واحد،
            باشتراك سنوي واحد وبدون حدود للأساتذة والطلاب.
          </p>

          {/* CTA Buttons */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/register"
              preload="intent"
              className="inline-flex min-h-[52px] items-center gap-2.5 rounded-[14px] bg-[#0B6B4B] px-7 text-base font-semibold text-white shadow-sm transition hover:bg-[#09573c]"
            >
              <span>سجّل مؤسستك الآن</span>
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <Link
              to="/pricing"
              preload="intent"
              className="inline-flex min-h-[52px] items-center rounded-[14px] border border-[#CFCABD] bg-white px-7 text-base font-medium text-[#14130F] shadow-sm transition hover:bg-neutral-50"
            >
              اطلع على الأسعار
            </Link>
          </div>
        </div>
      </section>

      {/* How it works Section */}
      <section id="how" className="border-y border-[#E3DFD5] bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-[#14130F] sm:text-4xl">
              كيف تعمل المنصة؟
            </h2>
            <p className="mt-2.5 text-base text-[#4A4943] sm:text-lg">
              أربع خطوات فقط تفصل مؤسستك عن منصة رقمية كاملة باسمها.
            </p>
          </div>

          {/* Steps: 3 on top row, 1 full-width on bottom row */}
          <div className="mt-12 space-y-5">
            {/* Top row: 3 cards */}
            <div className="grid gap-5 md:grid-cols-3">
              {/* Step 1 */}
              <div className="flex flex-col gap-3.5 rounded-[22px] border border-[#E3DFD5] bg-[#F6F4EF] p-7 transition hover:border-[#cfcabd]">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0B6B4B] text-lg font-bold text-white">
                  1
                </span>
                <h3 className="text-xl font-bold text-[#14130F]">تسجيل المؤسسة</h3>
                <p className="text-[15px] leading-relaxed text-[#4A4943]">
                  أدخل معلومات المؤسسة ومعلومات المدير.
                </p>
              </div>

              {/* Step 2 */}
              <div className="flex flex-col gap-3.5 rounded-[22px] border border-[#E3DFD5] bg-[#F6F4EF] p-7 transition hover:border-[#cfcabd]">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0B6B4B] text-lg font-bold text-white">
                  2
                </span>
                <h3 className="text-xl font-bold text-[#14130F]">اختيار الباقة والدفع</h3>
                <p className="text-[15px] leading-relaxed text-[#4A4943]">
                  ادفع 9,000 دج سنوياً عبر الحساب البريدي CCP.
                </p>
              </div>

              {/* Step 3 */}
              <div className="flex flex-col gap-3.5 rounded-[22px] border border-[#E3DFD5] bg-[#F6F4EF] p-7 transition hover:border-[#cfcabd]">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0B6B4B] text-lg font-bold text-white">
                  3
                </span>
                <h3 className="text-xl font-bold text-[#14130F]">رفع وصل الدفع</h3>
                <p className="text-[15px] leading-relaxed text-[#4A4943]">
                  صوّر الوصل بعد كتابة اسم المؤسسة عليه وارفعه.
                </p>
              </div>
            </div>

            {/* Bottom row: Step 4 spanning full width */}
            <div className="flex flex-col gap-3.5 rounded-[22px] border border-[#E3DFD5] bg-[#F6F4EF] p-7 transition hover:border-[#cfcabd]">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0B6B4B] text-lg font-bold text-white">
                4
              </span>
              <h3 className="text-xl font-bold text-[#14130F]">التفعيل خلال 24 ساعة</h3>
              <p className="text-[15px] leading-relaxed text-[#4A4943]">
                بعد التحقق اليدوي من الإدارة يُفَعّل حسابك مباشرة.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-[#F6F4EF] py-20 sm:py-24">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <div className="flex flex-col items-center rounded-[32px] bg-[#14130F] px-6 py-16 text-center text-white sm:px-12 sm:py-20">
            <h2 className="text-3xl font-bold sm:text-4xl lg:text-[42px]">
              جاهز لرقمنة مؤسستك؟
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-[#D8D5CB] sm:text-lg">
              سجّل مؤسستك اليوم، ادفع 9,000 دج عبر CCP، وارفع وصل الدفع ليتم تفعيل حسابك خلال 24 ساعة.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                to="/register"
                preload="intent"
                className="inline-flex min-h-[52px] items-center rounded-[14px] bg-white px-7 text-base font-bold text-[#14130F] shadow-sm transition hover:bg-neutral-100"
              >
                تسجيل مؤسسة جديدة
              </Link>
              <Link
                to="/contact"
                preload="intent"
                className="inline-flex min-h-[52px] items-center rounded-[14px] border border-[#6B6A62] bg-transparent px-7 text-base font-medium text-white shadow-sm transition hover:bg-white/10"
              >
                طلب تجربة أو تواصل
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
