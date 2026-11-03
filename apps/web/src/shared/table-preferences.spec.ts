import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { loadTablePreference, tablePreferenceQueryKey } from "./table-preferences";
vi.mock("../api", () => ({ api: vi.fn() }));

describe("server table preference query scopes", () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

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
