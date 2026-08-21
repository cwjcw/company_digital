export const DEFAULT_USER_PASSWORD = "kn123456";
export const ADMIN_USERNAME = "admin";

export function isPrimaryAdminUsername(username: string | null | undefined) {
  return String(username ?? "").trim().toLowerCase() === ADMIN_USERNAME;
}
