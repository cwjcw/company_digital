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
});
