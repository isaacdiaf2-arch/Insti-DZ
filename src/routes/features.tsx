import { createFileRoute, Link } from "@tanstack/react-router";
import { School, GraduationCap, Users, BookOpen, CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: "المميزات — نظام المواد والتخصصات | Insti DZ" },
      {
        name: "description",
        content:
          "كل مميزات Insti DZ: نظام متكامل للمؤسسات التعليمية والتكوينية الجزائرية، مع دعم كامل للبرامج والمواد الرسمية والشهادات المهنية.",
      },
      { property: "og:title", content: "المميزات — نظام المواد والتخصصات | Insti DZ" },
      {
        property: "og:description",
        content: "إدارة المؤسسة، المحتوى التعليمي، متابعة الطالب، والتكوين المهني.",
      },
    ],
  }),
  component: Features,
});

const levels = [
  {
    title: "الطور الابتدائي",
    badge: "التعليم الأساسي",
    body: "السنة الأولى والثانية: اللغة العربية، الرياضيات، التربية الإسلامية، التربية البدنية والفنية. السنة الثالثة تضيف الإنجليزية والتربية العلمية والتكنولوجية والتاريخ والجغرافيا. الرابعة والخامسة تضيف الفرنسية.",
  },
  {
    title: "الطور المتوسط (1-4)",
    badge: "التعليم المتوسط",
    body: "اللغة العربية، الرياضيات، الفرنسية، الإنجليزية، علوم الطبيعة والحياة، العلوم الفيزيائية والتكنولوجيا، التاريخ والجغرافيا، التربية الإسلامية والمدنية، المعلوماتية، التربية الفنية والبدنية، واللغة الأمازيغية.",
  },
  {
    title: "الطور الثانوي",
    badge: "التعليم الثانوي",
    body: "آداب وفلسفة، لغات أجنبية، علوم تجريبية، رياضيات، هندسة (تقني رياضي)، معلوماتية وذكاء اصطناعي، تسيير واقتصاد — مع إمكانية إضافة مواد وتخصصات مخصصة لكل مؤسسة.",
  },
  {
    title: "المراكز الخاصة واللغات",
    badge: "الدعم واللغات",
    body: "دروس الدعم، تعليم اللغات الأجنبية للأطفال والكبار، ودورات معتمدة قصيرة وطويلة مع توثيق أرقام الاعتماد والشهادات الصادرة.",
  },
  {
    title: "مراكز التكوين المهني (BT — 24 شهرًا)",
    badge: "تكوين مهني",
    body: "تقنيات الإدارة: المحاسبة، تسيير المخزونات، الأمانة المكتبية، التوثيق والأرشيف. التقنيات الحرفية والتجارية: بائع تجاري، صيانة التجهيزات المعلوماتية، البنوك، التأمينات. إضافة إلى التكوين التأهيلي القصير (3 إلى 6 أشهر).",
  },
  {
    title: "معاهد التكوين المتخصص (BTS — 30 شهرًا)",
    badge: "تقني سامي",
    body: "الإعلام الآلي والرقمنة، الأنظمة الرقمية، الأمن السيبراني وتطوير الويب، تسيير الموارد البشرية، المحاسبة والمالية، التجارة الدولية، الأمانة والمديرية، الصناعة والبيئة، الفندقة والسياحة ومربية الطفولة الأولى.",
  },
];

const pillars = [
  {
    icon: School,
    t: "مساحة مستقلة وهوية كاملة",
    d: "كل مؤسسة تحصل على مساحة خاصة بها مع إمكانية إضافة شعارها، غلافها، وأقسامها المستقلة دون تداخل.",
  },
  {
    icon: GraduationCap,
    t: "توسّع سلس وبدون حدود",
    d: "إضافة أساتذة، طلاب، أفواج وتخصصات غير محدودة دون أي تكاليف إضافية أو قيود على السعة.",
  },
  {
    icon: Users,
    t: "متابعة لحظية وشاملة",
    d: "جداول دراسية، حضور وغياب، اختبارات إلكترونية، وكشوف نقاط آلية للمدير والأستاذ والطالب.",
  },
];

function Features() {
  return (
    <div className="min-h-screen bg-[#F6F4EF] text-[#14130F] font-sans antialiased" dir="rtl">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#E4F1EB] px-4 py-1.5 text-xs font-semibold text-[#0B6B4B]">
            <BookOpen className="h-3.5 w-3.5" />
            <span>نظام المواد والتخصصات المتوافق مع البرامج الرسمية</span>
          </div>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-[#14130F] sm:text-5xl">
            كل ما تحتاجه مؤسستك التعليمية أو التكوينية
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-[#4A4943] sm:text-lg">
            مهيأة مسبقًا لكافة الأطوار والمناهج الجزائرية، مع إمكانية التخصيص الكامل حسب برامج كل معهد أو مركز.
          </p>
        </div>

        {/* Levels Grid */}
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {levels.map((lvl) => (
            <article
              key={lvl.title}
              className="flex flex-col rounded-[24px] border border-[#E3DFD5] bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-[#F6F4EF] px-3 py-1 text-xs font-medium text-[#73726C]">
                  {lvl.badge}
                </span>
                <CheckCircle2 className="h-4 w-4 text-[#0B6B4B]" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-[#14130F]">{lvl.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#4A4943]">{lvl.body}</p>
            </article>
          ))}
        </div>

        {/* Pillars */}
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {pillars.map((c) => (
            <article
              key={c.t}
              className="rounded-[24px] border border-[#E3DFD5] bg-white p-6 shadow-sm"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E4F1EB] text-[#0B6B4B]">
                <c.icon className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-base font-bold text-[#14130F]">{c.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#4A4943]">{c.d}</p>
            </article>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 rounded-[28px] bg-[#14130F] px-8 py-12 text-center text-white sm:py-14">
          <h2 className="text-2xl font-bold sm:text-3xl">جاهز للانطلاق مع Insti DZ؟</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-[#CFCABD] sm:text-base">
            سجّل مؤسستك الآن واكتشف سهولة الإدارة الرقمية للأساتذة والطلاب والدروس في مكان واحد.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to="/register"
              preload="intent"
              className="rounded-xl bg-[#0B6B4B] px-8 py-3 text-sm font-semibold text-white transition hover:bg-[#09573c]"
            >
              سجّل مؤسستك الآن
            </Link>
            <Link
              to="/pricing"
              preload="intent"
              className="rounded-xl border border-[#4A4943] bg-transparent px-8 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              اطلع على الأسعار
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
