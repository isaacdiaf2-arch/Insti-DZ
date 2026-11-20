import { createMiddleware } from '@tanstack/react-start';

// Browser authentication relies on HttpOnly cookie `sdz_session_token` set by server auth endpoints.
// Keep client middleware hook so non-browser/test environments can still pass explicit Bearer headers.
export const attachSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    return next();
  },
);
