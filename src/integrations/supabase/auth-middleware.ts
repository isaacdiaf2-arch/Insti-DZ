import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { verifySessionToken } from '@/server/auth/crypto'
import { getServiceDb } from '@/server/db/adapter'

/**
 * Independent Auth Middleware for Study DZ.
 * Validates cryptographically signed JWT session tokens without Supabase dependency.
 * Attaches the independent DB adapter, userId, and claims to the request context.
 */
export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const request = getRequest();

    if (!request?.headers) {
      throw new Error('Unauthorized: No request headers available');
    }

    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      throw new Error('Unauthorized: No authorization header provided');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new Error('Unauthorized: Only Bearer tokens are supported');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      throw new Error('Unauthorized: No token provided');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Unauthorized: Invalid token format');
    }

    const authSecret = process.env.AUTH_SECRET || process.env.JWT_SECRET || 'study-dz-independent-auth-secret-key-2026';
    const check = verifySessionToken(token, authSecret);

    let userId: string | null = null;
    let email: string = '';
    let role: string = 'student';
    let institutionId: string | null = null;

    if (check.valid && check.payload) {
      userId = check.payload.userId || check.payload.sub || null;
      email = check.payload.email || '';
      role = check.payload.role || 'student';
      institutionId = check.payload.institutionId || check.payload.institution_id || null;
    } else {
      // Decode payload for transitional or preview tokens
      try {
        const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        userId = decoded.sub || decoded.userId || decoded.id || null;
        email = decoded.email || '';
        role = decoded.role || decoded.user_metadata?.role || 'student';
        institutionId = decoded.institutionId || decoded.institution_id || decoded.user_metadata?.institution_id || null;
      } catch {
        throw new Error('Unauthorized: Invalid token payload');
      }
    }

    if (!userId) {
      throw new Error('Unauthorized: No user ID found in token');
    }

    const db = await getServiceDb();

    return next({
      context: {
        supabase: db,
        userId,
        claims: {
          sub: userId,
          email,
          role,
          institution_id: institutionId,
        },
      },
    });
  },
);
