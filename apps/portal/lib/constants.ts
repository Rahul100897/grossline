// Distinct from the admin cookie by name and by app — an admin session can
// never be read as a portal session or vice versa.
export const PORTAL_SESSION_COOKIE = 'grossline_portal_session';
export const PORTAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
