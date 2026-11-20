import { deleteCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/auth.shared";

export function applyServerSessionCookie(token: string) {
  try {
    setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
  } catch {
    // Non-HTTP unit test execution context
  }
}

export function clearServerSessionCookie() {
  try {
    deleteCookie(SESSION_COOKIE_NAME, { path: "/" });
  } catch {
    // Non-HTTP unit test execution context
  }
}

export function getClientMeta() {
  try {
    const req = getRequest();
    return {
      userAgent: req?.headers?.get("user-agent")?.slice(0, 255) ?? null,
      ipAddress:
        req?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim()?.slice(0, 64) ??
        req?.headers?.get("cf-connecting-ip")?.slice(0, 64) ??
        null,
    };
  } catch {
    return {};
  }
}
