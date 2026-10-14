// Adapted from ibnetsoft/wallet apps/admin/src/lib/admin-access.ts.
// Use only server-managed app_metadata; explicit permissions and default deny.
type AdminUser = { app_metadata?: Record<string, unknown> };
export function isAuthorizedAdmin(user: AdminUser | null) {
  return (
    user?.app_metadata?.adminConsole === true ||
    user?.app_metadata?.adminRole === "SUPER_ADMIN"
  );
}
export function canManageFunds(user: AdminUser | null) {
  return user?.app_metadata?.adminRole === "SUPER_ADMIN";
}
