import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getAccountProfile } from "@/lib/auth.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    let account = null;
    try {
      account = await getAccountProfile();
    } catch {
      throw redirect({ to: "/auth" });
    }

    if (!account?.user) {
      throw redirect({ to: "/auth" });
    }

    if (account.role !== "platform_admin") {
      const status = account.institution?.status;
      if (status === "expired" || status === "suspended") {
        throw redirect({
          to: "/auth",
          search: { redirect: undefined, blocked: status },
        });
      }
    }

    return { user: account.user, account };
  },
  component: () => <Outlet />,
});
