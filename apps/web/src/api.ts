const API_ROOT = "/api/v1";

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) { super(message); }
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) return false;
  const response = await fetch(`${API_ROOT}/auth/refresh`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken })
  });
  if (!response.ok) return false;
  const result = await response.json();
  localStorage.setItem("accessToken", result.accessToken);
  localStorage.setItem("refreshToken", result.refreshToken);
  localStorage.setItem("sessionUser", JSON.stringify(result.user));
  return true;
}

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = localStorage.getItem("accessToken");
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers });
  if (response.status === 401 && !retried && await refreshAccessToken()) return api<T>(path, init, true);
  if (!response.ok) {
    let details: any;
    try { details = await response.json(); } catch { details = null; }
    throw new ApiError(details?.message ?? `请求失败 (${response.status})`, response.status, details);
  }
  const type = response.headers.get("content-type") ?? "";
  return (type.includes("json") ? await response.json() : await response.blob()) as T;
}

export function getValue(row: any, key: string) {
  return key.split(".").reduce((value, part) => value?.[part], row);
}
