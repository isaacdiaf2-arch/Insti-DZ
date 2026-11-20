import { createMiddleware } from '@tanstack/react-start';
import { getCookie, getRequest } from '@tanstack/react-start/server';
import type { DbClient } from '@/server/db/adapter';
import { SESSION_COOKIE_NAME } from '@/lib/auth.shared';

export type AuthenticatedContext = {
  supabase: DbClient;
  userId: string;
  sessionId: string | null;
  claims: {
    sub: string;
    email: string;
    role: string;
    roles: string[];
    institution_id: string | null;
  };
};

export function extractSessionTokenFromRequest(
  request: Request,
  cookieLookup?: (name: string) => string | undefined,
): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    if (!authHeader.startsWith('Bearer ')) {
      throw new Error('Unauthorized: Only Bearer tokens are supported');
    }
    const bearer = authHeader.slice('Bearer '.length).trim();
    if (bearer) return bearer;
  }

  if (cookieLookup) {
    try {
      const val = cookieLookup(SESSION_COOKIE_NAME);
      if (val) return val;
    } catch {
      // Fallback to raw Cookie header parsing
    }
  }

  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) continue;
      const name = part.slice(0, eqIdx).trim();
      if (name === SESSION_COOKIE_NAME) {
        const raw = part.slice(eqIdx + 1).trim();
        try {
          return decodeURIComponent(raw);
        } catch {
          return raw;
        }
      }
    }
  }

  return null;
}

export function assertSameOriginRequest(request: Request): void {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite && secFetchSite.toLowerCase() === 'cross-site') {
    throw new Error('Forbidden: Cross-site request blocked');
  }

  const originHeader = request.headers.get('origin');
  if (!originHeader) return;

  let originHost: string;
  try {
    originHost = new URL(originHeader).host.toLowerCase();
  } catch {
    throw new Error('Forbidden: Malformed Origin header');
  }

  const expectedHosts = new Set<string>();
  const hostHeader = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (hostHeader) expectedHosts.add(hostHeader.split(',')[0].trim().toLowerCase());
  if (process.env.PUBLIC_URL) {
    try {
      expectedHosts.add(new URL(process.env.PUBLIC_URL).host.toLowerCase());
    } catch {
      // Ignore malformed PUBLIC_URL
    }
  }
  try {
    const reqUrlHost = new URL(request.url).host.toLowerCase();
    if (reqUrlHost) expectedHosts.add(reqUrlHost);
  } catch {
    // Request URL may be relative
  }

  if (expectedHosts.size > 0 && !expectedHosts.has(originHost)) {
    throw new Error('Forbidden: Origin mismatch');
  }
}

/**
 * Independent Auth Middleware for Insti DZ.
 * Strictly validates HS256 JWT session tokens (Bearer or HttpOnly cookie),
 * enforces Same-Origin CSRF checks, verifies active session in PostgreSQL `user_sessions`,
 * and loads authoritative role and institution_id from PostgreSQL.
 */
export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const request = getRequest();

    if (!request?.headers) {
      throw new Error('Unauthorized: No request headers available');
    }

    assertSameOriginRequest(request);

    const token = extractSessionTokenFromRequest(request, getCookie);
    if (!token) {
      throw new Error('Unauthorized: No session credentials provided');
    }

    const [{ getAuthSecret, verifySessionToken }, { withRlsDbClient }, { authenticateBearerToken }] = await Promise.all([
      import('@/server/auth/crypto'),
      import('@/server/db/adapter'),
      import('@/server/auth/bearer'),
    ]);

    const authSecret = getAuthSecret();
    const tokenCheck = verifySessionToken(token, authSecret);
    if (!tokenCheck.valid || !tokenCheck.payload) {
      throw new Error(`Unauthorized: Invalid or expired session token (${tokenCheck.reason ?? 'invalid'})`);
    }

    const tokenUserId: string | null = tokenCheck.payload.userId || tokenCheck.payload.sub || null;
    if (!tokenUserId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tokenUserId)) {
      throw new Error('Unauthorized: Invalid user ID in token');
    }

    return withRlsDbClient(tokenUserId, async (rlsDb) => {
      const authCtx = await authenticateBearerToken(token, rlsDb, authSecret, {
        requireSessionRecord: true,
      });
      return next({ context: authCtx });
    });
  },
);
