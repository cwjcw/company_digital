const API_ROOT = "/api/v1";

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) { super(message); }
}

function fallbackMessage(status: number) {
  if (status === 400) return "请求数据不正确，请检查后重试";
  if (status === 403) return "当前权限不足，无法执行此操作";
  if (status === 409) return "数据已发生变化，请刷新后重试";
  if (status === 413) return "上传文件过大，请缩小文件后重试";
  if (status >= 500) return "服务暂时异常，请稍后重试";
  return `请求失败（${status}）`;
}

function readableMessage(value: unknown, status: number) {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join("；") || fallbackMessage(status);
  return fallbackMessage(status);
}

let accessTokenRefresh: Promise<boolean> | null = null;

async function performAccessTokenRefresh() {
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

function refreshAccessToken() {
  if (!accessTokenRefresh) {
    accessTokenRefresh = performAccessTokenRefresh().finally(() => { accessTokenRefresh = null; });
  }
  return accessTokenRefresh;
}

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = localStorage.getItem("accessToken");
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let response: Response;
  try { response = await fetch(`${API_ROOT}${path}`, { ...init, headers }); }
  catch (error) {
    const aborted = (error as { name?: string }).name === "AbortError";
    throw new ApiError(aborted ? "请求超时，请稍后重试" : "网络连接失败，请检查网络后重试", 0, error);
  }
  if (response.status === 401 && !retried && await refreshAccessToken()) return api<T>(path, init, true);
  if (!response.ok) {
    let details: any;
    try { details = await response.json(); } catch { details = null; }
    throw new ApiError(readableMessage(details?.message, response.status), response.status, details);
  }
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
  const blob = await response.blob();
  return (blob.size ? blob : null) as T;
}

export function getValue(row: any, key: string) {
  return key.split(".").reduce((value, part) => value?.[part], row);
}

export function containsText(value: unknown, search: unknown) {
  const query = String(search ?? "").trim().toLocaleLowerCase();
  return !query || String(value ?? "").toLocaleLowerCase().includes(query);
}
