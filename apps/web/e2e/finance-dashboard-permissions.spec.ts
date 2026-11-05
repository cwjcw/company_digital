import { expect, test, type Page } from "@playwright/test";
import * as contractNamespace from "@kdos/contracts";
const { financeRankingFields, tablePermissionFieldsFor } = (contractNamespace as any).default ?? contractNamespace;

// Isolated role coverage: production acceptance with a real login is recorded separately.
test.use({ trace: "off", screenshot: "off", video: "off" });
const dashboardPath = "/finance/orders/dashboard?acceptance=permissions";
const resources = ["finance-e10-dashboard", "finance-e10-ranking"];

async function setup(page: Page, role: "system" | "finance" | "viewer" | "other-module") {
  const user = {
    sub: "synthetic-finance-permission-user", tenantId: "KAINAN", username: "synthetic",
    displayName: "隔离财务入口验收", isSystemAdmin: role === "system",
    moduleAdminCodes: role === "finance" ? ["finance"] : role === "other-module" ? ["planning"] : [],
    permissions: role === "system" || role === "finance" ? [] : resources.flatMap(resource => [
      `${resource}:*:read`, ...tablePermissionFieldsFor(resource).map((field: { key: string }) => `${resource}:${field.key}:read`)
    ]), mustChangePassword: false, roles: []
  };
  const requests: { path: string; method: string; body: Record<string, any> | null }[] = [];
  await page.addInitScript(user => {
    localStorage.setItem("accessToken", "synthetic-intercepted-token");
    localStorage.setItem("sessionUser", JSON.stringify(user));
  }, user);
  await page.route("**/socket.io/**", route => route.abort());
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    requests.push({ path, method: request.method(), body: request.postData() ? request.postDataJSON() : null });
    let json: unknown = [];
    if (path === "/auth/me") json = user;
    else if (path === "/auth/preferences/table-config") json = { config: null };
    else if (path === "/table-filters/resources") json = resources.map(code => ({ code, status: "REGISTERED_AND_FILTERABLE" }));
    else if (path === "/table-exports/capabilities" || path === "/table-prints/capabilities") json = [];
    else if (path === "/finance/e10-orders/revision") json = { revision: "synthetic-revision" };
    else if (path === "/finance/e10-orders/dashboard") {
      const year = request.postDataJSON().context.year;
      json = {
        totals: { amount: "100.30", orders: 2, average: "50.15", pendingAmount: "0.00", pendingCustomers: 0, pendingOrders: 0 },
        channels: [{ category: "内销", amount: "100.30", share: "1" }],
        departments: [{ category: "业务一部", amount: "100.30", share: "1" }],
        months: Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, "0")}`, amount: i ? "0.00" : "100.30", wan: i ? "0.000000" : "0.010030" }))
      };
    } else if (path === "/finance/e10-orders/ranking") {
      json = { rows: [{ id: "synthetic-ranking-row", ...Object.fromEntries(financeRankingFields.map((field: { key: string }) => [field.key, field.key === "customerCode" ? "SYN-RANK" : "100.30"])) }], total: 1 };
    } else if (path === "/admin/table-permission-context") json = { roles: [], roleGroups: [], users: [], organizations: [] };
    await route.fulfill({ json });
  });
  await page.goto(dashboardPath);
  await expect(page.getByText("SYN-RANK", { exact: true })).toBeVisible();
  return requests;
}

for (const role of ["system", "finance", "viewer", "other-module"] as const) {
  test(`${role}: dashboard and ranking permissions remain independent with a working return path`, async ({ page }, testInfo) => {
    const requests = await setup(page, role);
    const dashboardEntry = page.locator('a[href^="/permissions/finance-e10-dashboard?"]');
    const rankingEntry = page.locator('[data-resource="finance-e10-ranking"] a[href^="/permissions/finance-e10-ranking?"]');
    const administrator = role === "system" || role === "finance";
    await expect(dashboardEntry).toHaveCount(administrator ? 1 : 0);
    await expect(rankingEntry).toHaveCount(administrator ? 1 : 0);
    await expect(page.locator(".finance-dashboard canvas")).toHaveCount(3);
    if (administrator) {
      const refreshBox = await page.getByRole("button", { name: "刷新", exact: true }).boundingBox();
      const entryBox = await dashboardEntry.boundingBox();
      expect(entryBox!.y).toBeCloseTo(refreshBox!.y, 0);
      expect(entryBox!.x).toBeGreaterThan(refreshBox!.x);
      await page.screenshot({ path: testInfo.outputPath(`${role}-dashboard.png`) });
      for (const resource of resources) {
        await page.locator(`a[href^="/permissions/${resource}?"]`).click();
        await expect(page).toHaveURL(new RegExp(`/permissions/${resource}\\?`));
        expect(new URL(page.url()).searchParams.get("from")).toBe(dashboardPath);
        await expect(page.getByRole("heading", { name: resource === resources[0] ? "对成员发布 · 统计大屏" : "对成员发布 · 客户年度金额排名" })).toBeVisible();
        await page.getByText("返回原表", { exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${dashboardPath.replace("?", "\\?")}$`));
        await expect(page.getByText("SYN-RANK", { exact: true })).toBeVisible();
      }
    }
    await page.getByRole("searchbox", { name: "客户编号", exact: true }).fill("SYN-FILTER");
    await page.getByRole("searchbox", { name: "客户编号", exact: true }).press("Enter");
    await expect.poll(() => requests.some(request => request.path.endsWith("/dashboard") && request.body?.context.customerCode === "SYN-FILTER")).toBe(true);
    const count = () => requests.filter(request => request.path.endsWith("/dashboard")).length;
    const before = count();
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect.poll(count).toBeGreaterThan(before);
    expect(requests.filter(request => request.method !== "GET" && !["/finance/e10-orders/dashboard", "/finance/e10-orders/ranking"].includes(request.path))).toEqual([]);
  });
}
