import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAccountProfile, logoutSession } from "./auth.functions";
import { SESSION_COOKIE_NAME, SESSION_STORAGE_KEY } from "@/lib/auth.shared";

export type AppRole = "platform_admin" | "institution_admin" | "teacher" | "student";

export const roleLabels: Record<AppRole, string> = {
  platform_admin: "مدير المنصة",
  institution_admin: "مدير المؤسسة",
  teacher: "أستاذ",
  student: "طالب",
};

export const roleHome: Record<AppRole, string> = {
  platform_admin: "/admin",
  institution_admin: "/institution",
  teacher: "/teacher",
  student: "/student",
};

/**
 * Session tokens are issued strictly via HttpOnly server cookies (`sdz_session_token`).
 * Any legacy client-readable storage keys are cleared defensively.
 */
export function persistSessionToken(_token?: string | null) {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem("sdz_auth_token");
  }
}

export function useAccount() {
  const getProfileFn = useServerFn(getAccountProfile);

  return useQuery({
    queryKey: ["account"],
    queryFn: async () => {
      try {
        const res = await getProfileFn();
        return res;
      } catch {
        return null;
      }
    },
    staleTime: 1000 * 60 * 5,
  });
}

export async function signOutEverything() {
  try {
    await logoutSession();
  } catch {
    // Proceed with local cleanup even if session was already expired/revoked
  }
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem("sdz_auth_token");
  }
  if (typeof document !== "undefined") {
    document.cookie = `${SESSION_COOKIE_NAME}=; Max-Age=0; path=/;`;
    document.cookie = "sdz_token=; Max-Age=0; path=/;";
  }
}
