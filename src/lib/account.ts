import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAccountProfile } from "./auth.functions";

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
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("sdz_session_token");
    localStorage.removeItem("sdz_auth_token");
  }
  if (typeof document !== "undefined") {
    document.cookie = "sdz_token=; Max-Age=0; path=/;";
  }
}
