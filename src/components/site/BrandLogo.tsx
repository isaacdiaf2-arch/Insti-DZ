import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { openReservedConsole } from "@/lib/vault.functions";
import { completeTotpLogin } from "@/lib/auth.functions";
import { persistSessionToken } from "@/lib/account";
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

export function BrandLogo(_props?: {
  size?: "sm" | "md";
  subtitle?: boolean;
}) {
  const navigate = useNavigate();
  const openConsole = useServerFn(openReservedConsole);
  const completeTotp = useServerFn(completeTotpLogin);

  const clicks = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [passcode, setPasscode] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
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
      setChallengeToken(null);
      setTotpCode("");
      setOpen(true);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (challengeToken) {
        const verified = await completeTotp({
          data: { challengeToken, code: totpCode.trim() },
        });
        persistSessionToken(verified.token);
        setOpen(false);
        setIdentifier("");
        setPasscode("");
        setChallengeToken(null);
        setTotpCode("");
        toast.success("مرحبًا بك في لوحة تحكم مدير المنصة.");
        navigate({ to: "/admin" });
        return;
      }

      const result = await openConsole({
        data: { identifier: identifier.trim(), passcode },
      });
      if (!result.ok) throw new Error("بيانات الدخول غير صحيحة.");

      if (result.requiresTotp && result.challengeToken) {
        setChallengeToken(result.challengeToken);
        toast.info("أدخل رمز التحقق الثنائي (2FA) لإتمام الدخول.");
        return;
      }

      persistSessionToken(result.accessToken);
      setOpen(false);
      setIdentifier("");
      setPasscode("");
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

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setChallengeToken(null);
            setTotpCode("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>دخول محجوز</DialogTitle>
            <DialogDescription>
              {challengeToken
                ? "أدخل رمز التحقق من تطبيق المصادقة أو رمز الاسترداد."
                : "أدخل بيانات الدخول المحجوزة للوصول إلى لوحة تحكم مدير المنصة."}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submit}>
            {!challengeToken ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="unlock-identifier">معرّف الدخول</Label>
                  <Input
                    id="unlock-identifier"
                    type="text"
                    autoComplete="off"
                    dir="ltr"
                    autoFocus
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="unlock-password">كلمة المرور</Label>
                  <Input
                    id="unlock-password"
                    type="password"
                    required
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="unlock-totp">رمز التحقق الثنائي (6 أرقام أو رمز استرداد)</Label>
                <Input
                  id="unlock-totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  autoFocus
                  required
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "جارٍ التحقق…" : challengeToken ? "تأكيد الدخول" : "دخول"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
