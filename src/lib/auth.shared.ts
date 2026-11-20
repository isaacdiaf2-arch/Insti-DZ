export const SESSION_COOKIE_NAME = "sdz_session_token";
export const SESSION_STORAGE_KEY = "sdz_session_token";
export const SESSION_TTL_SECONDS = 86400 * 7;

export const ROLE_PRIORITY: readonly string[] = [
  "platform_admin",
  "institution_admin",
  "teacher",
  "student",
];

export function sortRoleRows<T extends { role?: string | null }>(rows: T[] | null | undefined): T[] {
  if (!rows || rows.length === 0) return [];
  return [...rows].sort((a, b) => {
    const idxA = ROLE_PRIORITY.indexOf(String(a.role ?? ""));
    const idxB = ROLE_PRIORITY.indexOf(String(b.role ?? ""));
    return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
  });
}

