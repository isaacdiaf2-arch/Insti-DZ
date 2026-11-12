import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer id="contact" className="border-t border-[#E3DFD5] bg-white">
      <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-12 px-4 py-14 sm:px-6">
        {/* Brand & Description */}
        <div className="flex max-w-[420px] flex-1 basis-[320px] flex-col gap-3.5">
          <div className="flex items-center gap-2.5">
            <img
              src="/insti-dz-logo.png"
              alt="Insti DZ"
              className="h-10 w-auto object-contain"
              width={48}
              height={40}
            />
          </div>
          <p className="text-[15px] leading-relaxed text-[#4A4943]">
            Insti DZ نظام رقمي للمؤسسات التعليمية والتكوينية في الجزائر، متاح عبر منصة سحابية موّحدة تجمع إدارة المؤسسة والتعليم والتعلّم والمتابعة في نظام واحد.
          </p>
        </div>

        {/* Quick Links */}
        <div className="flex flex-col gap-3 text-[15px]">
          <span className="text-base font-bold text-[#14130F]">روابط سريعة</span>
          <Link to="/pricing" preload="intent" className="text-[#4A4943] transition hover:text-[#14130F]">
            الأسعار
          </Link>
          <Link to="/register" preload="intent" className="text-[#4A4943] transition hover:text-[#14130F]">
            تسجيل مؤسسة جديدة
          </Link>
          <Link to="/pricing" hash="payment" preload="intent" className="text-[#4A4943] transition hover:text-[#14130F]">
            الاشتراك والدفع عبر CCP
          </Link>
        </div>

        {/* Contact info */}
        <div className="flex max-w-[320px] flex-col gap-3 text-[15px]">
          <span className="text-base font-bold text-[#14130F]">التواصل</span>
          <p className="text-[15px] leading-relaxed text-[#4A4943]">
            كل التواصل والدعم يتم داخل المنصة فقط عبر صفحة التواصل والدعم، لضمان متابعة كل طلب وتوثيقه.
          </p>
          <Link
            to="/contact"
            preload="intent"
            className="font-semibold text-[#14130F] underline underline-offset-4 transition hover:opacity-80"
          >
            صفحة التواصل والدعم
          </Link>
        </div>
      </div>

      <div className="border-t border-[#E3DFD5] py-5 text-center text-[13px] text-[#5B5A55]">
        © Insti DZ 2026 — جميع الحقوق محفوظة.
      </div>
    </footer>
  );
}
