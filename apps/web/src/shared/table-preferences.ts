import { api } from "../api";
import { queryOptions } from "@tanstack/react-query";
import { tablePermissionFieldsFor, type TableResourceCode } from "@kdos/contracts";

export type TablePreferenceType = "DISPLAY" | "PRINT";
export type TableDisplayPreferences = {
  version: 1;
  visibleFieldKeys: string[];
  orderedFieldKeys: string[];
  columnWidths: Record<string, number>;
  pinnedFieldKeys: string[];
};

export type TablePreferenceFailure = { phase: "read" | "migration"; status: number; retryable: boolean; message: string };
export type TablePreferenceResult<T> = { config: T | null; migrationError?: TablePreferenceFailure };

export function describeTablePreferenceError(error: unknown, phase: "read" | "migration" = "read"): TablePreferenceFailure {
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 0;
  const reason = status === 400 ? "配置参数被服务端拒绝（HTTP 400）"
    : status === 401 ? "登录状态已失效（HTTP 401），请重新登录"
    : status === 403 ? "当前账号无权读取或保存配置（HTTP 403）"
    : status === 404 ? "配置接口不存在（HTTP 404），请联系管理员核对部署版本"
    : status === 429 ? "配置服务请求过于频繁（HTTP 429），正在等待重试"
    : status >= 500 ? `配置服务暂时异常（HTTP ${status}），请稍后重试`
    : /超时|timeout/i.test(error instanceof Error ? error.message : "") ? "配置请求超时，请稍后重试"
    : status === 0 ? "暂时无法连接配置服务，请稍后重试" : `配置请求失败（HTTP ${status}）`;
  return { phase, status, retryable: status === 0 || status === 429 || status >= 500,
    message: phase === "migration" ? `旧版个人布局同步失败：${reason}。当前仍保留旧布局，尚未同步到其他设备。` : `个人字段设置读取失败：${reason}。` };
}

const migrationFlights = new Map<string, Promise<TablePreferenceResult<unknown>>>();
const migrationFailures = new Map<string, { signature: string; until: number; error: TablePreferenceFailure }>();
const migrationKey = (resource: string, viewKey: string | undefined, type: TablePreferenceType) => JSON.stringify(tablePreferenceQueryKey(resource, viewKey, type));
const migrationMarker = (key: string) => `kdos-table-preference-migrated:${key}`;
function markLegacyConsumed(key: string) { try { localStorage.setItem(migrationMarker(key), "1"); } catch { /* Keep the original layout if browser storage is unavailable. */ } }

export function retryTablePreferenceMigration(resource: string, viewKey: string | undefined, type: TablePreferenceType) {
  migrationFailures.delete(migrationKey(resource, viewKey, type));
}

export function tablePreferenceQueryOptions<T>(resource: string, viewKey: string | undefined, type: TablePreferenceType) {
  return queryOptions({
    queryKey: tablePreferenceQueryKey(resource, viewKey, type),
    queryFn: ({ signal }) => loadTablePreference<T>(resource, viewKey, type, signal),
    staleTime: 300_000, gcTime: 1_800_000, placeholderData: undefined, refetchOnWindowFocus: false, refetchOnReconnect: "always",
    retryOnMount: false,
    retry: (count, error) => count < 2 && describeTablePreferenceError(error).retryable,
    retryDelay: (count) => Math.min(1000 * 2 ** count, 5000),
    refetchInterval: (query) => {
      const failure = query.state.data?.migrationError ?? (query.state.error ? describeTablePreferenceError(query.state.error) : undefined);
      return failure?.retryable ? 30_000 : false;
    }
  });
}

/** Client identity only namespaces the query cache; the API derives identity and tenant from authentication. */
export function tablePreferenceCacheScope() {
  try {
    const session = JSON.parse(localStorage.getItem("sessionUser") ?? "{}") as { sub?: unknown; tenantId?: unknown; tenantCode?: unknown };
    return `${String(session.tenantId ?? session.tenantCode ?? "")}:${String(session.sub ?? "")}`;
  } catch { return ""; }
}

export function tablePreferenceQueryKey(resource: string, viewKey: string | undefined, configType: TablePreferenceType) {
  return ["table-preference", tablePreferenceCacheScope(), resource, viewKey ?? "", configType] as const;
}

function legacyPreferenceConfig(resource: string, viewKey: string | undefined, configType: TablePreferenceType): unknown | null {
  try {
    const session = JSON.parse(localStorage.getItem("sessionUser") ?? "{}") as { sub?: string; tenantId?: string; tenantCode?: string };
    if (!session.sub) return null;
    const tenant = String(session.tenantId ?? session.tenantCode ?? "KAINAN");
    const view = viewKey ? `${resource}:${viewKey}` : resource;
    const parse = (value: string | null) => value ? JSON.parse(value) as unknown : null;
    if (configType === "DISPLAY") {
      const keys = (prefix: string, legacy = false) => legacy
        ? `${prefix}:${session.sub}:${view}`
        : `${prefix}:${encodeURIComponent(tenant)}:${encodeURIComponent(session.sub!)}:${encodeURIComponent(view)}`;
      const visible = parse(localStorage.getItem(keys("kdos-form-view")) ?? localStorage.getItem(keys("kdos-form-view", true)));
      const widths = parse(localStorage.getItem(keys("kdos-form-column-widths")) ?? localStorage.getItem(keys("kdos-form-column-widths", true)));
      const pinned = parse(localStorage.getItem(keys("kdos-form-pinned")) ?? localStorage.getItem(keys("kdos-form-pinned", true)));
      const pinnedFieldKeys = Array.isArray(pinned) ? pinned.filter((key): key is string => typeof key === "string") : [];
      const columnWidths = widths && typeof widths === "object" && !Array.isArray(widths)
        ? Object.fromEntries(Object.entries(widths).filter(([, width]) => typeof width === "number" && Number.isFinite(width) && width > 0 && width <= 10000))
        : {};
      if (!Array.isArray(visible) && !pinnedFieldKeys.length && !Object.keys(columnWidths).length) return null;
      /* Absence of a visibility setting means the old default layout, not "hide every column".
         These are preference keys only; the table still intersects them with current field permissions. */
      const visibleFieldKeys = Array.isArray(visible) ? visible.filter((key): key is string => typeof key === "string")
        : tablePermissionFieldsFor(resource as TableResourceCode).map(field => field.key);
      return { version: 1, visibleFieldKeys, orderedFieldKeys: visibleFieldKeys, columnWidths,
        pinnedFieldKeys: pinnedFieldKeys.filter(key => visibleFieldKeys.includes(key)) };
    }
    const key = `kdos-print-v1:${[tenant, session.sub, resource, viewKey ?? ""].map(encodeURIComponent).join(":")}`;
    const saved = parse(localStorage.getItem(key));
    return saved && typeof saved === "object" && !Array.isArray(saved) && (saved as { version?: unknown }).version === 1 ? saved : null;
  } catch { return null; }
}

function preferencePath(resource: string, viewKey: string | undefined, configType: TablePreferenceType) {
  const params = new URLSearchParams({ resource, configType });
  if (viewKey) params.set("viewKey", viewKey);
  return `/auth/preferences/table-config?${params.toString()}`;
}

export async function loadTablePreference<T>(resource: string, viewKey: string | undefined, configType: TablePreferenceType, signal?: AbortSignal): Promise<TablePreferenceResult<T>> {
  const scope = tablePreferenceCacheScope();
  const timeout = AbortSignal.timeout(10_000);
  const result = await api<TablePreferenceResult<T>>(preferencePath(resource, viewKey, configType), { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (tablePreferenceCacheScope() !== scope) throw Object.assign(new Error("登录账号已变化，请重新加载个人设置"), { status: 401 });
  if (result.config != null) return result;
  const key = migrationKey(resource, viewKey, configType);
  try { if (localStorage.getItem(migrationMarker(key))) return result; } catch { /* Reading the server does not depend on browser storage. */ }
  const legacy = legacyPreferenceConfig(resource, viewKey, configType);
  if (legacy == null) return result;
  const signature = JSON.stringify(legacy);
  const failed = migrationFailures.get(key);
  if (failed?.signature === signature && failed.until > Date.now()) return { config: legacy as T, migrationError: failed.error };
  const existing = migrationFlights.get(key);
  if (existing) return existing as Promise<TablePreferenceResult<T>>;
  const flight = (async (): Promise<TablePreferenceResult<T>> => {
    try {
      const migrated = await saveTablePreference<T>(resource, viewKey, configType, legacy as T, true);
      migrationFailures.delete(key);
      return { config: migrated.config ?? legacy as T };
    } catch (error) {
      const failure = describeTablePreferenceError(error, "migration");
      migrationFailures.set(key, { signature, until: Date.now() + (failure.retryable ? 30_000 : 300_000), error: failure });
      return { config: legacy as T, migrationError: failure };
    } finally { migrationFlights.delete(key); }
  })();
  migrationFlights.set(key, flight);
  return flight;
}

export async function saveTablePreference<T>(resource: string, viewKey: string | undefined, configType: TablePreferenceType, config: T | null, ifMissing = false) {
  const key = migrationKey(resource, viewKey, configType);
  const result = await api<{ config: T | null; reset: boolean }>("/auth/preferences/table-config", {
    method: "PUT", body: JSON.stringify({ resource, viewKey, configType, config, ifMissing })
  });
  markLegacyConsumed(key);
  migrationFailures.delete(key);
  return result;
}
