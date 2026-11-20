import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Bell,
  LogOut,
  Maximize2,
  Menu,
  Moon,
  RefreshCw,
  Sun,
  LifeBuoy,
  X,
} from "lucide-react";
import { useAccount, signOutEverything } from "@/lib/account";
import { Button } from "@/components/ui/button";

export interface NavItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem("sdz-theme");
    const isDark = stored === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);
  function toggle() {
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem("sdz-theme", next ? "dark" : "light");
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  }
  return { dark, toggle };
}

export function DashboardShell({
  title,
  nav,
  active,
  onChange,
  notifications = 0,
  children,
}: {
  title: string;
  nav: NavItem[];
  active: string;
  onChange: (key: string) => void;
  notifications?: number;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isLoading = useRouterState({ select: (s) => s.status === "pending" });
  const { dark, toggle } = useDarkMode();
  const [open, setOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);

  const account = useAccount();
  const me = {
    data: {
      email: account.data?.profile?.email ?? account.data?.user?.email ?? "",
      name: account.data?.profile ? `${account.data.profile.first_name} ${account.data.profile.last_name}`.trim() : "",
    },
  };

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOutEverything();
    navigate({ to: "/auth", replace: true });
  }


  function goFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }

  const activeLabel = nav.find((n) => n.key === active)?.label ?? title;
  const initials = (me.data?.name || me.data?.email || "?").trim().charAt(0).toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      <Link to="/" className="mb-3 flex items-center gap-2 rounded-xl px-2 py-2">
        <img src="/insti-dz-logo.png" alt="شعار Insti DZ" className="h-9 w-9 rounded-full object-contain" />
        <span className="min-w-0">
          <span className="block font-display text-base font-extrabold leading-tight">Insti DZ</span>
          <span className="block truncate text-[11px] text-muted-foreground">{title}</span>
        </span>
      </Link>

      {nav.map((item) => {
        const Icon = item.icon;
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              onChange(item.key);
              setOpen(false);
            }}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              isActive
                ? "bg-brand text-brand-foreground font-semibold shadow-[var(--shadow-lift)]"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}

      <div className="mt-auto rounded-xl border border-border bg-brand-soft p-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <LifeBuoy className="h-4 w-4" />
          الدعم الفني
        </p>
        <p className="mt-1 text-xs text-muted-foreground">متواجدون لمساعدتك في أي وقت</p>
        <Link
          to="/contact"
          onClick={() => setOpen(false)}
          className="mt-2 block rounded-lg bg-brand px-3 py-2 text-center text-xs font-semibold text-brand-foreground"
        >
          تواصل معنا
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto flex max-w-[1500px]">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-s border-border bg-sidebar lg:block">
          {sidebar}
        </aside>

        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="إغلاق القائمة"
              className="absolute inset-0 bg-foreground/40"
              onClick={() => setOpen(false)}
            />
            <div className="absolute inset-y-0 end-0 w-72 bg-sidebar shadow-[var(--shadow-lift)]">
              <div className="flex justify-start p-2">
                <Button variant="ghost" size="icon" aria-label="إغلاق" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="h-[calc(100%-3rem)]">{sidebar}</div>
            </div>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
            <div className="flex items-center gap-2 px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="القائمة"
                className="lg:hidden"
                onClick={() => setOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>

              <div className="min-w-0 flex-1">
                <h1 className="truncate font-display text-lg font-extrabold">{activeLabel}</h1>
                <p className="truncate text-xs text-muted-foreground">{title}</p>
              </div>

              <Button
                variant="ghost"
                size="icon"
                aria-label="تحديث البيانات"
                onClick={() => queryClient.invalidateQueries()}
              >
                <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              </Button>
              <Button variant="ghost" size="icon" aria-label="ملء الشاشة" onClick={goFullscreen}>
                <Maximize2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={dark ? "الوضع النهاري" : "الوضع الليلي"}
                onClick={toggle}
              >
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="الإشعارات"
                  onClick={() => setAlertsOpen((v) => !v)}
                >
                  <Bell className="h-4 w-4" />
                </Button>
                {notifications > 0 && (
                  <span className="pointer-events-none absolute -top-0.5 end-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-bold leading-4 text-destructive-foreground">
                    {notifications}
                  </span>
                )}
                {alertsOpen && (
                  <div className="absolute end-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-background p-3 shadow-[var(--shadow-lift)]">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <span className="text-xs font-bold">الإشعارات</span>
                      <button
                        type="button"
                        onClick={() => setAlertsOpen(false)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        إغلاق
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {notifications > 0
                        ? `لديك ${notifications} عنصرًا بانتظار المراجعة أو المتابعة.`
                        : "لا توجد تنبيهات غير مقروءة حاليًا."}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={() => {
                        setAlertsOpen(false);
                        void queryClient.invalidateQueries();
                      }}
                    >
                      تحديث الحالة
                    </Button>
                  </div>
                )}
              </div>

              <div className="hidden items-center gap-2 rounded-xl border border-border px-2 py-1.5 sm:flex">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                  {initials}
                </span>
                <span className="min-w-0 max-w-[140px]">
                  <span className="block truncate text-xs font-semibold">
                    {me.data?.name || "مستخدم"}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {me.data?.email}
                  </span>
                </span>
              </div>

              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <LogOut className="ms-1 h-4 w-4" />
                خروج
              </Button>
            </div>
          </header>

          <main className="px-4 py-6 sm:px-6">{children}</main>

          <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground">
            Insti DZ — منصة سحابية جزائرية لإدارة التعليم · الإصدار 1.0
          </footer>
        </div>
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "brand",
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "brand" | "info" | "success" | "warning" | "destructive";
}) {
  const tones: Record<string, string> = {
    brand: "bg-brand-soft text-brand",
    info: "bg-info-soft text-info",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    destructive: "bg-destructive-soft text-destructive",
  };
  return (
    <div className="card-soft flex items-center gap-3 p-4">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-2xl font-extrabold leading-tight">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

export function QuickAction({
  label,
  icon: Icon,
  tone = "brand",
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "brand" | "info" | "success" | "warning" | "destructive";
  onClick: () => void;
}) {
  const tones: Record<string, string> = {
    brand: "bg-brand text-brand-foreground",
    info: "bg-info text-info-foreground",
    success: "bg-success text-success-foreground",
    warning: "bg-warning text-warning-foreground",
    destructive: "bg-destructive text-destructive-foreground",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-2 rounded-2xl px-3 py-4 text-xs font-semibold transition-transform hover:-translate-y-0.5 ${tones[tone]}`}
    >
      <Icon className="h-5 w-5" />
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}

export function ModuleCard({
  title,
  description,
  icon: Icon,
  count,
  onClick,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-soft flex w-full items-start gap-3 p-4 text-start transition-shadow hover:shadow-[var(--shadow-lift)]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-display font-bold">{title}</span>
          {count !== undefined && (
            <span className="rounded-full bg-secondary px-2 text-[11px] text-muted-foreground">
              {count}
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}
