import { api } from "../api";

export type TablePreferenceType = "DISPLAY" | "PRINT";
export type TableDisplayPreferences = {
  version: 1;
  visibleFieldKeys: string[];
  orderedFieldKeys: string[];
  columnWidths: Record<string, number>;
  pinnedFieldKeys: string[];
};

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
      const visibleFieldKeys = Array.isArray(visible) ? visible.filter((key): key is string => typeof key === "string") : [];
      const pinnedFieldKeys = Array.isArray(pinned) ? pinned.filter((key): key is string => typeof key === "string") : [];
      const columnWidths = widths && typeof widths === "object" && !Array.isArray(widths)
        ? Object.fromEntries(Object.entries(widths).filter(([, width]) => typeof width === "number" && Number.isFinite(width) && width > 0 && width <= 10000))
        : {};
      if (!visibleFieldKeys.length && !pinnedFieldKeys.length && !Object.keys(columnWidths).length) return null;
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

export async function loadTablePreference<T>(resource: string, viewKey: string | undefined, configType: TablePreferenceType) {
  const result = await api<{ config: T | null }>(preferencePath(resource, viewKey, configType));
  if (result.config != null) return result;
  const legacy = legacyPreferenceConfig(resource, viewKey, configType);
  if (legacy == null) return result;
  const migrated = await saveTablePreference<T>(resource, viewKey, configType, legacy as T, true);
  return { config: migrated.config ?? legacy as T };
}

export async function saveTablePreference<T>(resource: string, viewKey: string | undefined, configType: TablePreferenceType, config: T | null, ifMissing = false) {
  return api<{ config: T | null; reset: boolean }>("/auth/preferences/table-config", {
    method: "PUT", body: JSON.stringify({ resource, viewKey, configType, config, ifMissing })
  });
}
