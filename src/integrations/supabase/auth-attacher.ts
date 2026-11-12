import { createMiddleware } from '@tanstack/react-start'

// Must be registered as a global `functionMiddleware` in `src/start.ts`; otherwise
// the browser never attaches the bearer token to serverFn RPCs.
export const attachSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    let token: string | null = null;
    if (typeof localStorage !== 'undefined') {
      token = localStorage.getItem('sdz_session_token') || localStorage.getItem('sdz_auth_token');
    }

    // If no token in local storage, check cookie or preview session
    if (!token && typeof document !== 'undefined') {
      const match = document.cookie.match(/sdz_token=([^;]+)/);
      if (match) token = match[1];
    }

    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
