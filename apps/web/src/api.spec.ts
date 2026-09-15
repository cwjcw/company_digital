import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("api response parsing", () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("returns null for an empty successful response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await expect(api<null>("/planning/periods/by-month?year=2026&month=8")).resolves.toBeNull();
  });

  it("parses a JSON response without changing its shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "period-1" }));

    await expect(api<{ id: string }>("/planning/periods/by-month?year=2026&month=9"))
      .resolves.toEqual({ id: "period-1" });
  });

  it("shares one token refresh across concurrent expired requests", async () => {
    localStorage.setItem("accessToken", "expired-access");
    localStorage.setItem("refreshToken", "current-refresh");
    let refreshCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return Response.json({
          accessToken: "fresh-access", refreshToken: "fresh-refresh", user: { sub: "user-1" }
        });
      }
      const authorization = new Headers(init?.headers).get("Authorization");
      return authorization === "Bearer expired-access"
        ? Response.json({ message: "登录已过期" }, { status: 401 })
        : Response.json({ status: "ok", path: url });
    });

    await expect(Promise.all([
      api("/plans/sales-dashboard"), api("/reference-data/dictionaries"), api("/auth/me")
    ])).resolves.toHaveLength(3);
    expect(refreshCalls).toBe(1);
    expect(localStorage.getItem("accessToken")).toBe("fresh-access");
    expect(localStorage.getItem("refreshToken")).toBe("fresh-refresh");
  });

  it.each([[400, "请求数据不正确"], [403, "当前权限不足"], [409, "数据已发生变化"], [413, "上传文件过大"], [500, "服务暂时异常"]])("maps HTTP %s without a business message", async (status, expected) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}, { status }));
    await expect(api("/master-plan-system/resources/mps-shipping-plans/import-preview")).rejects.toThrow(expected);
  });

  it("maps network failures to a user-readable message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api("/master-plan-system/resources/mps-shipping-plans/import-preview")).rejects.toThrow("网络连接失败，请检查网络后重试");
  });
});
