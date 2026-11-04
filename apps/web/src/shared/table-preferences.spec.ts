import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { QueryClient } from "@tanstack/react-query";
import { describeTablePreferenceError, loadTablePreference, retryTablePreferenceMigration, saveTablePreference, tablePreferenceQueryKey, tablePreferenceQueryOptions, type TableDisplayPreferences } from "./table-preferences";
vi.mock("../api", () => ({ api: vi.fn() }));

describe("server table preference query scopes", () => {
  beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "u1", tenantId: "t1" }));
    retryTablePreferenceMigration("projects", "active", "DISPLAY");
  });

  it.each([null, { version: 1, visibleFieldKeys: ["name"] }])("reads a server configuration or a new user's empty configuration: %j", async (config) => {
    vi.mocked(api).mockResolvedValue({ config } as never);
    await expect(loadTablePreference("projects", "active", "DISPLAY")).resolves.toEqual({ config });
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 429, 500, 503])("classifies HTTP %s and retries only transient failures", async (status) => {
    const error = Object.assign(new Error("server response"), { status });
    vi.mocked(api).mockRejectedValue(error);
    const client = new QueryClient();
    const options = tablePreferenceQueryOptions("projects", "active", "DISPLAY");
    await expect(client.fetchQuery({ ...options, retryDelay: 0 })).rejects.toBe(error);
    expect(api).toHaveBeenCalledTimes([429, 500, 503].includes(status) ? 3 : 1);
    expect(describeTablePreferenceError(error).message).toContain(String(status));
    client.clear();
  });

  it("recovers a short network interruption without replacing the server layout with defaults", async () => {
    vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error("network"), { status: 0 })).mockResolvedValue({ config: { visibleFieldKeys: ["name"] } } as never);
    const client = new QueryClient();
    await expect(client.fetchQuery({ ...tablePreferenceQueryOptions("projects", "active", "DISPLAY"), retryDelay: 0 }))
      .resolves.toEqual({ config: { visibleFieldKeys: ["name"] } });
    expect(api).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it("loads multiple resources and views concurrently, sharing only identical query scopes", async () => {
    vi.mocked(api).mockImplementation(async path => {
      const query = new URL(path, "http://local").searchParams;
      return { config: { scope: [query.get("resource"), query.get("viewKey")] } } as never;
    });
    const client = new QueryClient();
    const actual = tablePreferenceQueryOptions("mps-process-reports", "ACTUAL", "DISPLAY");
    const results = await Promise.all([
      client.fetchQuery(actual), client.fetchQuery(actual),
      client.fetchQuery(tablePreferenceQueryOptions("mps-process-reports", "PENDING", "DISPLAY")),
      client.fetchQuery(tablePreferenceQueryOptions("equipment-register", undefined, "DISPLAY"))
    ]);
    expect(api).toHaveBeenCalledTimes(3);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).not.toEqual(results[2]);
    expect(results[2]).not.toEqual(results[3]);
    client.clear();
  });

  it("does not confuse a failed legacy PUT with a successful GET; preserves and retries the original layout safely", async () => {
    localStorage.setItem("kdos-form-view:t1:u1:projects%3Aactive", JSON.stringify(["name", "createdAt"]));
    localStorage.setItem("kdos-form-column-widths:t1:u1:projects%3Aactive", JSON.stringify({ createdAt: 175 }));
    let putFails = true;
    vi.mocked(api).mockImplementation(async (_path, init) => {
      if (init?.method === "PUT") {
        if (putFails) throw Object.assign(new Error("系统审计字段不可由客户端赋值：createdAt"), { status: 400 });
        return { config: JSON.parse(String(init.body)).config } as never;
      }
      return { config: null } as never;
    });
    const first = await loadTablePreference<TableDisplayPreferences>("projects", "active", "DISPLAY");
    expect(first.config?.columnWidths).toEqual({ createdAt: 175 });
    expect(first.migrationError).toMatchObject({ phase: "migration", status: 400 });
    await loadTablePreference("projects", "active", "DISPLAY");
    expect(vi.mocked(api).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(localStorage.getItem("kdos-form-view:t1:u1:projects%3Aactive")).toBe(JSON.stringify(["name", "createdAt"]));
    putFails = false;
    retryTablePreferenceMigration("projects", "active", "DISPLAY");
    await expect(loadTablePreference("projects", "active", "DISPLAY")).resolves.toEqual({ config: first.config });
  });

  it("deduplicates concurrent migrations and never reimports a consumed legacy layout after restore-default", async () => {
    localStorage.setItem("kdos-form-view:t1:u1:projects%3Aactive", JSON.stringify(["name"]));
    vi.mocked(api).mockImplementation(async (_path, init) => init?.method === "PUT"
      ? { config: JSON.parse(String(init.body)).config } as never : { config: null } as never);
    await Promise.all([loadTablePreference("projects", "active", "DISPLAY"), loadTablePreference("projects", "active", "DISPLAY")]);
    expect(vi.mocked(api).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    await saveTablePreference("projects", "active", "DISPLAY", null);
    vi.mocked(api).mockClear();
    await expect(loadTablePreference("projects", "active", "DISPLAY")).resolves.toEqual({ config: null });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("migrates a widths-only legacy layout without turning absent visibility into an empty field list", async () => {
    localStorage.setItem("kdos-form-column-widths:t1:u1:equipment-register", JSON.stringify({ createdAt: 175 }));
    vi.mocked(api).mockImplementation(async (_path, init) => init?.method === "PUT"
      ? { config: JSON.parse(String(init.body)).config } as never : { config: null } as never);
    const result = await loadTablePreference<TableDisplayPreferences>("equipment-register", undefined, "DISPLAY");
    expect(result.config?.columnWidths).toEqual({ createdAt: 175 });
    expect(result.config?.visibleFieldKeys).toContain("equipmentCode");
    expect(result.config?.visibleFieldKeys).toContain("createdAt");
    expect(result.config?.visibleFieldKeys.length).toBeGreaterThan(0);
  });

  it("does not migrate another user's local settings if the account changes while GET is pending", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(() => new Promise(resolve => { finish = resolve as (value: unknown) => void; }));
    const pending = loadTablePreference("projects", "active", "DISPLAY");
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "u2", tenantId: "t1" }));
    localStorage.setItem("kdos-form-view:t1:u2:projects%3Aactive", JSON.stringify(["name"]));
    finish({ config: null });
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("keeps user, tenant, resource, view and configuration type independent", () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "u1", tenantId: "t1" }));
    const display = tablePreferenceQueryKey("projects", "active", "DISPLAY");
    expect(tablePreferenceQueryKey("projects", "active", "PRINT")).not.toEqual(display);
    expect(tablePreferenceQueryKey("projects", "archived", "DISPLAY")).not.toEqual(display);
    expect(tablePreferenceQueryKey("tasks", "active", "DISPLAY")).not.toEqual(display);
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "u2", tenantId: "t1" }));
    expect(tablePreferenceQueryKey("projects", "active", "DISPLAY")).not.toEqual(display);
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "u1", tenantId: "t2" }));
    expect(tablePreferenceQueryKey("projects", "active", "DISPLAY")).not.toEqual(display);
  });

  it("migrates a legacy local display layout to the authenticated preference service only when no server value exists", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "u1", tenantId: "t1" }));
    localStorage.setItem("kdos-form-view:t1:u1:projects%3Aactive", JSON.stringify(["name", "number"]));
    localStorage.setItem("kdos-form-column-widths:t1:u1:projects%3Aactive", JSON.stringify({ name: 220 }));
    vi.mocked(api).mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PUT") return { config: JSON.parse(String(init.body)).config, reset: false } as never;
      return { config: null } as never;
    });
    await expect(loadTablePreference("projects", "active", "DISPLAY")).resolves.toEqual({ config: {
      version: 1, visibleFieldKeys: ["name", "number"], orderedFieldKeys: ["name", "number"], columnWidths: { name: 220 }, pinnedFieldKeys: []
    } });
    const request = vi.mocked(api).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ resource: "projects", viewKey: "active", configType: "DISPLAY", ifMissing: true });
  });

  it("imports a legacy print layout into its separate PRINT preference scope", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "u1", tenantId: "t1" }));
    const legacy = { version: 1, columnKeys: ["name"], widths: { name: 24 }, paperSize: "A3", orientation: "landscape", widthMode: "custom" };
    localStorage.setItem("kdos-print-v1:t1:u1:projects:active", JSON.stringify(legacy));
    vi.mocked(api).mockImplementation(async (_path: string, init?: RequestInit) => init?.method === "PUT"
      ? { config: JSON.parse(String(init.body)).config, reset: false } as never : { config: null } as never);
    await expect(loadTablePreference("projects", "active", "PRINT")).resolves.toEqual({ config: legacy });
    expect(JSON.parse(String(vi.mocked(api).mock.calls[1]?.[1]?.body))).toMatchObject({ configType: "PRINT", ifMissing: true });
  });
});
