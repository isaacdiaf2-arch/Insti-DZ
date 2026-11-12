import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { openReservedConsole } from "@/lib/vault.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import logo from "@/assets/studydz-logo-new.png.asset.json";

export function BrandLogo({
  size = "md",
  subtitle = true,
}: {
  size?: "sm" | "md";
  subtitle?: boolean;
}) {
  const box = size === "sm" ? "h-9 w-9" : "h-11 w-11";
  const navigate = useNavigate();
  const openConsole = useServerFn(openReservedConsole);

  const clicks = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  function registerClick() {
    clicks.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      clicks.current = 0;
    }, 700);
    if (clicks.current >= 3) {
      clicks.current = 0;
      if (timer.current) clearTimeout(timer.current);
      setOpen(true);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await openConsole({
        data: { identifier: email.trim(), passcode: password },
      });
      if (!result.ok) throw new Error("بيانات الدخول غير صحيحة.");

      localStorage.setItem("sdz_session_token", result.accessToken);
      localStorage.setItem("sdz_auth_token", result.accessToken);
      document.cookie = `sdz_session_token=${encodeURIComponent(result.accessToken)}; path=/; max-age=604800; SameSite=Lax`;

      setOpen(false);
      setEmail("");
      setPassword("");
      toast.success("مرحبًا بك في لوحة تحكم مدير المنصة.");
      navigate({ to: "/admin" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر الدخول.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Link
        to="/"
        preload="intent"
        onClick={registerClick}
        className="flex shrink-0 items-center select-none"
        aria-label="Insti DZ"
      >
        <img
          src="/insti-dz-logo.png"
          alt="Insti DZ"
          className="h-11 w-auto object-contain"
          width={53}
          height={44}
        />
      </Link>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>دخول محجوز</DialogTitle>
            <DialogDescription>
              أدخل بيانات الدخول المحجوزة للوصول إلى لوحة تحكم مدير المنصة.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="unlock-email">رقم الهاتف</Label>
              <Input
                id="unlock-email"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                dir="ltr"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="unlock-password">كلمة المرور</Label>
              <Input
                id="unlock-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "جارٍ التحقق…" : "دخول"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
