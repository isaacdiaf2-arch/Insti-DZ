import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { BrandLogo } from "@/components/site/BrandLogo";

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[#E3DFD5] bg-[#F6F4EF]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <BrandLogo />

        <nav className="hidden items-center gap-7 text-[15px] font-medium text-[#3C3B36] md:flex">
          <Link
            to="/"
            hash="how"
            preload="intent"
            className="transition hover:text-[#14130F]"
          >
            كيف تعمل
          </Link>
          <Link
            to="/features"
            preload="intent"
            activeProps={{ className: "text-[#14130F] font-semibold" }}
            className="transition hover:text-[#14130F]"
          >
            المميزات
          </Link>
          <Link
            to="/pricing"
            preload="intent"
            activeProps={{ className: "text-[#14130F] font-semibold" }}
            className="transition hover:text-[#14130F]"
          >
            الأسعار
          </Link>
          <Link
            to="/contact"
            preload="intent"
            activeProps={{ className: "text-[#14130F] font-semibold" }}
            className="transition hover:text-[#14130F]"
          >
            التواصل
          </Link>
        </nav>

        <div className="hidden items-center gap-2.5 sm:flex">
          <Link
            to="/auth"
            preload="intent"
            className="flex min-h-[44px] items-center rounded-xl border border-[#CFCABD] bg-white px-5 text-[15px] font-medium text-[#14130F] shadow-sm transition hover:bg-neutral-50"
          >
            تسجيل الدخول
          </Link>
          <Link
            to="/register"
            preload="intent"
            className="flex min-h-[44px] items-center rounded-xl bg-[#14130F] px-5 text-[15px] font-semibold text-white shadow-sm transition hover:bg-black"
          >
            سجّل مؤسستك
          </Link>
        </div>

        <button
          type="button"
          aria-label="القائمة"
          onClick={() => setOpen((v) => !v)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#CFCABD] bg-white text-[#14130F] sm:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <nav className="border-t border-[#E3DFD5] bg-[#F6F4EF] px-4 py-4 sm:hidden">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-2">
            <Link
              to="/"
              hash="how"
              preload="intent"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2 text-[15px] font-medium text-[#3C3B36] hover:bg-black/5 hover:text-[#14130F]"
            >
              كيف تعمل
            </Link>
            <Link
              to="/features"
              preload="intent"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2 text-[15px] font-medium text-[#3C3B36] hover:bg-black/5 hover:text-[#14130F]"
            >
              المميزات
            </Link>
            <Link
              to="/pricing"
              preload="intent"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2 text-[15px] font-medium text-[#3C3B36] hover:bg-black/5 hover:text-[#14130F]"
            >
              الأسعار
            </Link>
            <Link
              to="/contact"
              preload="intent"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2 text-[15px] font-medium text-[#3C3B36] hover:bg-black/5 hover:text-[#14130F]"
            >
              التواصل
            </Link>
            <div className="mt-2 flex flex-col gap-2 pt-2 border-t border-[#E3DFD5]">
              <Link
                to="/auth"
                preload="intent"
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-[#CFCABD] bg-white px-5 text-[15px] font-medium text-[#14130F]"
              >
                تسجيل الدخول
              </Link>
              <Link
                to="/register"
                preload="intent"
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center justify-center rounded-xl bg-[#14130F] px-5 text-[15px] font-semibold text-white"
              >
                سجّل مؤسستك
              </Link>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
