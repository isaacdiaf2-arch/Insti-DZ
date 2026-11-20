import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { persistSessionToken, signOutEverything } from "@/lib/account";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { useServerFn } from "@tanstack/react-start";
import { startDemoSession } from "@/lib/demo.functions";
import { DEMO_ACCOUNTS, type DemoRoleKey } from "@/lib/demo.shared";
import { checkLoginRateLimit } from "@/lib/rate-limit.functions";
import { completeTotpLogin, loginWithCredentials } from "@/lib/auth.functions";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({
    redirect: z.string().optional(),
    blocked: z.enum(["expired", "suspended"]).optional(),
  }),
  head: () => ({
    meta: [
      { title: "تسجيل الدخول | Insti DZ" },
      {
        name: "description",
        content: "سجّل الدخول إلى حسابك في منصة Insti DZ: مدير مؤسسة، أستاذ أو طالب.",
      },
      { property: "og:title", content: "تسجيل الدخول | Insti DZ" },
      { property: "og:description", content: "الدخول إلى لوحة التحكم الخاصة بك في Insti DZ." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Step = "credentials" | "totp";

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [step, setStep] = useState<Step>("credentials");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);

  const startDemo = useServerFn(startDemoSession);
  const checkRate = useServerFn(checkLoginRateLimit);
  const finishTotpLogin = useServerFn(completeTotpLogin);
  const [demoBusy, setDemoBusy] = useState<DemoRoleKey | null>(null);

  const blockedMessage = search.blocked
    ? search.blocked === "expired"
      ? "انتهى اشتراك مؤسستك. يرجى التجديد عبر صفحة الاشتراك للوصول إلى المنصة."
      : "تم إيقاف مؤسستك. تواصل مع إدارة المنصة لإعادة التفعيل."
    : null;

  const showDemoAccounts =
    !import.meta.env.PROD && import.meta.env.VITE_ENABLE_DEMO_MODE === "true";

  const rawRedirect = search.redirect;
  const destination =
    rawRedirect && rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/dashboard";
  function goToDestination() {
    navigate({ to: destination });
  }

  async function handleDemo(role: DemoRoleKey) {
    setError(null);
    setDemoBusy(role);
    try {
      const res = await startDemo({ data: { role } });
      if (res.token) {
        persistSessionToken(res.token);
      }
      toast.success(`تم الدخول بحساب تجريبي: ${DEMO_ACCOUNTS[role].label}`);
      navigate({ to: "/dashboard" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "تعذّر فتح الحساب التجريبي.";
      setError(message);
      toast.error(message);
    } finally {
      setDemoBusy(null);
    }
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (lockedUntil && Date.now() < lockedUntil) {
      const wait = Math.ceil((lockedUntil - Date.now()) / 1000);
      setError(`تم إيقاف المحاولات مؤقتًا. حاول بعد ${wait} ثانية.`);
      return;
    }

    const identifier = email.trim().toLowerCase();
    try {
      const rateCheck = await checkRate({ data: { identifier } });
      if (rateCheck.locked) {
        const until = Date.now() + (rateCheck.waitSeconds ?? 60) * 1000;
        setLockedUntil(until);
        setError("تم تجاوز الحد المسموح من المحاولات الفاشلة. حاول لاحقًا.");
        return;
      }
    } catch { /* server enforces limit authoritatively inside loginWithCredentials */ }

    setLoading(true);
    try {
      const result = await loginWithCredentials({ data: { email: identifier, password } });
      if (result?.requiresTotp && result.challengeToken) {
        setChallengeToken(result.challengeToken);
        setStep("totp");
        setLoading(false);
        return;
      }
      if (result?.token) {
        persistSessionToken(result.token);
        setLoading(false);
        goToDestination();
        return;
      }
      throw new Error("بيانات الدخول غير صحيحة.");
    } catch (err: any) {
      setLoading(false);
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      if (nextAttempts >= 5) {
        setLockedUntil(Date.now() + 60_000);
        setAttempts(0);
        setError("تم تجاوز 5 محاولات فاشلة. تم إيقاف المحاولات لمدة 60 ثانية.");
      } else {
        const message = err?.message || "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
        setError(message);
        toast.error(message);
      }
    }
  }


  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeToken || totpCode.trim().length < 6) return;
    setError(null);
    setTotpLoading(true);

    try {
      const result = await finishTotpLogin({
        data: { challengeToken, code: totpCode.trim() },
      });
      if (result?.token) {
        persistSessionToken(result.token);
        goToDestination();
      } else {
        setError("تعذّر إتمام التحقق بخطوتين.");
        setTotpCode("");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "رمز التحقق غير صحيح أو منتهي الصلاحية.";
      setError(msg);
      setTotpCode("");
    } finally {
      setTotpLoading(false);
    }
  }

  async function handleSignOutAndBack() {
    await signOutEverything();
    setChallengeToken(null);
    setStep("credentials");
    setTotpCode("");
    setError(null);
  }


  if (step === "totp") {
    return (
      <div className="min-h-screen bg-[#F6F4EF] text-[#14130F]" dir="rtl">
        <SiteHeader />
        <main className="mx-auto flex max-w-md flex-col justify-center px-4 py-20 sm:px-6">
          <div className="rounded-[28px] border border-[#E3DFD5] bg-white p-8 shadow-sm sm:p-10">
            <h1 className="text-3xl font-bold">التحقق بخطوتين</h1>
            <p className="mt-2 text-sm text-[#4A4943]">
              أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة الخاص بك أو أحد أكواد الاستعادة.
            </p>
            <form className="mt-8 space-y-5" onSubmit={handleTotpSubmit}>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={8}
                  value={totpCode}
                  onChange={setTotpCode}
                  dir="ltr"
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <div className="space-y-1">
                <Label htmlFor="backup-code-input" className="text-xs text-[#4A4943]">
                  أو أدخل كود الاستعادة الاحتياطي (8 خانات)
                </Label>
                <Input
                  id="backup-code-input"
                  dir="ltr"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.trim())}
                  placeholder="000000"
                  className="text-center font-mono"
                />
              </div>
              {error && (
                <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full min-h-[48px] rounded-[14px] bg-[#14130F] text-white hover:bg-black" disabled={totpLoading || totpCode.trim().length < 6}>
                {totpLoading ? "جارٍ التحقق…" : "تأكيد الرمز"}
              </Button>
            </form>
            <button
              type="button"
              onClick={handleSignOutAndBack}
              className="mt-4 block w-full text-center text-sm text-[#4A4943] underline"
            >
              العودة وتسجيل الدخول بحساب آخر
            </button>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F4EF] text-[#14130F]" dir="rtl">
      <SiteHeader />

      <main className="mx-auto flex max-w-[1040px] flex-wrap items-start justify-center gap-8 px-4 py-16 sm:px-6 sm:py-20">
        {/* Right Card: Login Card */}
        <section className="flex flex-1 basis-[420px] min-w-0 max-w-[480px] flex-col gap-6 rounded-[28px] border border-[#E3DFD5] bg-white p-8 shadow-[0_24px_48px_-28px_rgba(20,19,15,0.18)] sm:p-11">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[34px] font-bold tracking-tight text-[#14130F] sm:text-[38px]">
              تسجيل الدخول
            </h1>
            <p className="text-base text-[#4A4943]">أدخل بيانات حسابك للمتابعة</p>
          </div>

          <form className="flex flex-col gap-4" onSubmit={handleCredentials}>
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#14130F]" htmlFor="email">
                البريد الإلكتروني
              </label>
              <input
                id="email"
                type="email"
                dir="ltr"
                required
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[48px] rounded-xl border border-[#CFCABD] bg-white px-3.5 text-[15px] text-[#14130F] outline-none transition focus:border-[#0B6B4B] focus:ring-1 focus:ring-[#0B6B4B]"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#14130F]" htmlFor="password">
                كلمة المرور
              </label>
              <input
                id="password"
                type="password"
                dir="ltr"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-[48px] rounded-xl border border-[#CFCABD] bg-white px-3.5 text-[15px] text-[#14130F] outline-none transition focus:border-[#0B6B4B] focus:ring-1 focus:ring-[#0B6B4B]"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
                {error}
              </p>
            )}
            {blockedMessage && !error && (
              <p role="alert" className="rounded-xl bg-amber-100 px-3.5 py-2.5 text-sm text-amber-900">
                {blockedMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex min-h-[52px] items-center justify-center rounded-[14px] bg-[#14130F] text-base font-semibold text-white shadow-sm transition hover:bg-black disabled:opacity-60 cursor-pointer"
            >
              {loading ? "جارٍ الدخول…" : "دخول"}
            </button>
          </form>

          <div className="flex flex-col items-center gap-2 pt-1 text-[15px]">
            <Link
              to="/forgot-password"
              preload="intent"
              className="font-semibold text-[#14130F] underline underline-offset-4 transition hover:opacity-80"
            >
              نسيت كلمة المرور؟
            </Link>
            <span className="text-[#4A4943]">
              مؤسسة جديدة؟{" "}
              <Link
                to="/register"
                preload="intent"
                className="font-bold text-[#0B6B4B] underline underline-offset-4 transition hover:opacity-80"
              >
                سجّل مؤسستك
              </Link>
            </span>
          </div>
        </section>

        {/* Left Card: Demo Accounts Card (development-only opt-in) */}
        {showDemoAccounts && (
          <section className="flex flex-1 basis-[420px] min-w-0 max-w-[480px] flex-col gap-5 rounded-[28px] border border-[#CFE3D9] bg-[#E4F1EB] p-7 sm:p-8">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-2xl font-bold text-[#14130F]">حسابات تجريبية</h2>
              <p className="text-[15px] leading-relaxed text-[#3C3B36]">
                جرّب المنصة فورًا بحساب مؤقت مخصص لكل دور، ضمن مؤسسة تجريبية منفصلة عن البيانات الحقيقية.
              </p>
            </div>

            <div className="flex flex-col gap-3.5">
              {(Object.keys(DEMO_ACCOUNTS) as DemoRoleKey[]).map((role) => (
                <div
                  key={role}
                  className="flex flex-wrap items-center justify-between gap-3.5 rounded-[20px] bg-white p-5 shadow-sm"
                >
                  <div className="flex-1 basis-[220px] min-w-0 flex flex-col gap-1">
                    <h3 className="text-lg font-bold text-[#14130F]">
                      {DEMO_ACCOUNTS[role].label}
                    </h3>
                    <p className="text-sm text-[#4A4943] leading-snug">
                      {DEMO_ACCOUNTS[role].description}
                    </p>
                    <span dir="ltr" className="text-[13px] text-[#5B5A55] text-right">
                      {DEMO_ACCOUNTS[role].email} · {DEMO_ACCOUNTS[role].password}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={demoBusy !== null}
                    onClick={() => handleDemo(role)}
                    className="flex min-h-[44px] items-center rounded-xl border border-[#0B6B4B] px-4 text-sm font-semibold text-[#0B6B4B] transition hover:bg-[#E4F1EB] disabled:opacity-60 cursor-pointer"
                  >
                    {demoBusy === role ? "جارٍ التحضير…" : "دخول تجريبي"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
