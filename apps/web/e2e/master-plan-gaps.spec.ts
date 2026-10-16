import { expect, test, type Page } from "@playwright/test";
import contracts from "@kdos/contracts";
const { mpsDashboardGaps, tablePermissionFieldsFor } = contracts;
const resource = "mps-overview-dashboard", division = "0199d000-0000-7000-8000-000000000010";
const fields = tablePermissionFieldsFor(resource).map(f => f.key);
async function mount(page: Page, permissions = ["*"], mode = "data") {
  const user = { sub: "synthetic-gaps-user", permissions, isSystemAdmin: permissions.includes("*"), tableDataScopes: [] };
  await page.addInitScript(u => { localStorage.setItem("accessToken", "synthetic-intercepted-token"); localStorage.setItem("sessionUser", JSON.stringify(u)); }, user);
  await page.route("**/api/v1/**", async route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/auth/me")) return route.fulfill({ json: user });
    if (u.pathname.endsWith("/dashboard/gap-counts")) {
      if (mode === "error") return route.fulfill({ status: 500, json: { message: "合成缺口查询失败" } });
      if (mode === "loading") await new Promise(resolve => setTimeout(resolve, 800));
      return route.fulfill({ json: { gaps: Object.fromEntries(mpsDashboardGaps.map(g => [g.key, mode === "empty" ? 0 : 125])), visibleFields: fields, generatedAt: "2026-10-16T02:00:00Z" } });
    }
    if (u.pathname.endsWith("/dashboard/candidates")) return route.fulfill({ json: { options: u.searchParams.get("field") === "divisionId" ? [{ value: division, label: "合成事业部" }] : [{ value: "SYN-GAPS", label: "SYN-GAPS" }], hasMore: false } });
    if (u.pathname.endsWith("/dashboard/gaps")) {
      const p = Number(u.searchParams.get("page") || 1), size = Number(u.searchParams.get("pageSize") || 100), total = mode === "empty" ? 0 : u.searchParams.has("search") ? 1 : 125;
      return route.fulfill({ json: { rows: Array.from({ length: Math.max(0, Math.min(size, total - (p - 1) * size)) }, (_, i) => ({ id: `synthetic-${u.searchParams.get("type")}-${(p - 1) * size + i}`, divisionId: division, divisionName: "合成事业部", orderNumber: `SYN-${(p - 1) * size + i + 1}`, itemCode: "ITEM", itemName: "合成品名", currentNode: "计划", currentStatus: "待处理", plannedQuantity: "500", requiredQuantity: "500", pendingQuantity: "500", exceptionSummary: "人工测试异常" })), total, page: p, pageSize: size, visibleFields: fields } });
    }
    if (u.pathname.endsWith("/dashboard/export")) return route.fulfill({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers: { "content-disposition": `attachment; filename="mps_${u.searchParams.get("tableKey")!.replaceAll("-", "_")}_20261016.xlsx"` }, body: Buffer.from("synthetic-download") });
    return route.fulfill({ json: [] });
  });
  await page.goto("/master-plan-gaps");
}
for (const width of [1366, 1920]) test(`gaps ${width}: nine KPIs, server rows, compact/sticky/single scroll, no repeated title`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); await mount(page);
  await expect(page.getByRole("cell", { name: "SYN-1", exact: true })).toBeVisible();
  const dashboard = page.locator(".mps-gaps-dashboard");
  await expect(dashboard.locator(".mps-kpi")).toHaveCount(9);
  await expect(dashboard.getByText("待处理事项大屏", { exact: true })).toHaveCount(0);
  await expect(dashboard.getByText("订单概况", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("tabpanel").locator(".ant-table-tbody tr.ant-table-row")).toHaveCount(100);
  expect(await dashboard.evaluate(el => Array.from(el.querySelectorAll("*")).filter(e => ["auto", "scroll"].includes(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 30).length)).toBe(0);
  const row = page.getByRole("tabpanel").locator(".ant-table-row").first();
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(36);
  await page.getByRole("cell", { name: "SYN-35", exact: true }).scrollIntoViewIfNeeded();
  const header = page.getByRole("tabpanel").locator(".ant-table-sticky-holder");
  await expect(header).toBeVisible(); expect((await header.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: info.outputPath(`gaps-${width}.png`) });
});
test("nine KPI clicks select corresponding independent lists and English exports", async ({ page }) => {
  const requests: URL[] = []; page.on("request", r => { if (r.url().includes("/dashboard/")) requests.push(new URL(r.url())); });
  await mount(page); await expect(page.getByRole("cell", { name: "SYN-1", exact: true })).toBeVisible();
  expect(requests.filter(u => u.pathname.endsWith("/gaps"))).toHaveLength(1);
  for (const gap of mpsDashboardGaps) {
    await page.getByRole("button", { name: `${gap.title} 125`, exact: true }).click();
    await expect(page.getByRole("tab", { name: `${gap.title} 125`, exact: true })).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel"); await expect(panel.getByRole("cell", { name: "SYN-1", exact: true })).toBeVisible();
    await expect(panel.getByText("共 125 条", { exact: false })).toBeVisible();
    const pending = page.waitForEvent("download"); await panel.getByRole("button", { name: "导出", exact: true }).click();
    expect((await pending).suggestedFilename()).toMatch(new RegExp(`^mps_${gap.key.replaceAll("-", "_")}_\\d{8}\\.xlsx$`));
    expect(requests.findLast(u => u.pathname.endsWith("/export"))!.searchParams.get("tableKey")).toBe(gap.key);
  }
});
test("top remote filters/date cascade across counts/lists/export; clear and refresh", async ({ page }) => {
  const urls: URL[] = []; page.on("request", r => { if (r.url().includes("/dashboard/")) urls.push(new URL(r.url())); });
  await mount(page); await expect(page.getByRole("cell", { name: "SYN-1", exact: true })).toBeVisible();
  const choose = async (name: string, label: string) => { const c = page.getByRole("combobox", { name, exact: true }); await c.focus(); if (await c.getAttribute("aria-expanded") !== "true") await c.press("ArrowDown"); await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option:visible .ant-select-item-option-content").getByText(label, { exact: true }).click(); await c.press("Escape"); await expect(c).toHaveAttribute("aria-expanded", "false"); };
  await choose("事业部", "合成事业部"); await choose("客户", "SYN-GAPS"); await choose("订单号", "SYN-GAPS"); await choose("品号", "SYN-GAPS");
  await choose("日期类型", "交付日期"); await choose("日期周期", "按月");
  const date = page.getByRole("textbox", { name: "日期值", exact: true }); await date.fill("2026-10"); await date.press("Enter"); await page.keyboard.press("Escape");
  const complete = (u: URL) => u.searchParams.get("dateValue") === "2026-10" && u.searchParams.get("divisionId") === division && u.searchParams.get("orderNumbers") === '["SYN-GAPS"]' && u.searchParams.get("itemCodes") === '["SYN-GAPS"]' && u.searchParams.get("customerCode") === "SYN-GAPS";
  await expect.poll(() => urls.some(u => u.pathname.endsWith("/gap-counts") && complete(u))).toBe(true);
  await expect.poll(() => urls.some(u => u.pathname.endsWith("/gaps") && complete(u))).toBe(true);
  const download = page.waitForEvent("download"); await page.getByRole("tabpanel").getByRole("button", { name: "导出", exact: true }).click(); await download;
  expect(complete(urls.findLast(u => u.pathname.endsWith("/export"))!)).toBe(true);
  await page.getByRole("button", { name: "清空筛选", exact: true }).click(); await expect(page.getByRole("combobox", { name: "日期周期", exact: true })).toHaveCount(0);
  const refresh = page.waitForRequest(r => new URL(r.url()).pathname.endsWith("/gap-counts") && !new URL(r.url()).searchParams.has("divisionId"));
  await page.getByRole("button", { name: "刷新数据", exact: true }).click(); await refresh;
});
test("tabs retain independent server page/sort/search and reset on top scope", async ({ page }) => {
  const urls: URL[] = []; page.on("request", r => { if (r.url().includes("/dashboard/gaps?")) urls.push(new URL(r.url())); });
  await mount(page); const panel = page.getByRole("tabpanel"); await expect(panel.getByRole("cell", { name: "SYN-1", exact: true })).toBeVisible();
  await panel.locator(".ant-pagination-item-2").click(); await expect(panel.getByRole("cell", { name: "SYN-101", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "未入库 125", exact: true }).click(); await expect(panel.getByRole("cell", { name: "SYN-1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "未进入出货计划 125", exact: true }).click(); await expect(panel.getByRole("cell", { name: "SYN-101", exact: true })).toBeVisible();
  await panel.getByRole("columnheader", { name: "订单号", exact: false }).click();
  await expect.poll(() => urls.at(-1)?.searchParams.get("sortField")).toBe("orderNumber");
  const search = panel.getByRole("searchbox", { name: "未进入出货计划搜索", exact: true }); await search.fill("SYN-1"); await search.press("Enter");
  await expect.poll(() => urls.at(-1)?.searchParams.get("search")).toBe("SYN-1"); expect(urls.at(-1)!.searchParams.get("page")).toBe("1");
  await expect(page.getByRole("button", { name: "未进入出货计划 125", exact: true })).toBeVisible();
  const order = page.getByRole("combobox", { name: "订单号", exact: true }); await order.focus(); await order.press("ArrowDown");
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option:visible .ant-select-item-option-content").getByText("SYN-GAPS", { exact: true }).click(); await order.press("Escape");
  await expect.poll(() => urls.at(-1)?.searchParams.get("orderNumbers")).toBe('["SYN-GAPS"]');
  expect(urls.at(-1)!.searchParams.get("page")).toBe("1");expect(urls.at(-1)!.searchParams.has("search")).toBe(false);expect(urls.at(-1)!.searchParams.has("sortField")).toBe(false);
});
test("no read denies route/navigation; read without export hides downloads", async ({ page }) => {
  let calls = 0; page.on("request", r => { if (r.url().includes("/master-plan-system/dashboard")) calls++; });
  await mount(page, ["mps-monthly-plans:*:read"]); await expect(page).toHaveURL(/\/$/); expect(calls).toBe(0);
  await expect(page.getByRole("menuitem", { name: "待处理事项大屏", exact: true })).toHaveCount(0);
  await page.unrouteAll(); await mount(page, [`${resource}:*:read`]);
  await expect(page.getByRole("cell", { name: "SYN-1", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "导出", exact: true })).toHaveCount(0);
});
test("loading, empty and error states remain explicit", async ({ page }) => {
  await mount(page, ["*"], "loading"); await expect(page.getByLabel("加载中", { exact: true })).toBeVisible(); await expect(page.getByRole("cell", { name: "SYN-1", exact: true })).toBeVisible();
  await page.unrouteAll(); await mount(page, ["*"], "empty"); await expect(page.getByRole("tab", { name: "未进入出货计划 0", exact: true })).toBeVisible(); await expect(page.getByRole("tabpanel").locator(".ant-empty-description").getByText("暂无数据", { exact: true })).toBeVisible();
  await page.unrouteAll(); await mount(page, ["*"], "error"); await expect(page.getByText("合成缺口查询失败", { exact: true })).toBeVisible();
});
