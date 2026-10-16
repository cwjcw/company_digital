import { expect, test, type Page } from "@playwright/test";
import { standardProcesses } from "@tracker/shared";
import contracts, { type MpsDashboardSummary } from "@kdos/contracts";
const { tablePermissionFieldsFor, mpsDashboardGaps } = contracts;
const resource = "mps-overview-dashboard", divisionId = "0199d000-0000-7000-8000-000000000010";
function fixture(): MpsDashboardSummary {
  return { gaps: Object.fromEntries(mpsDashboardGaps.map(g => [g.key, 125])), visibleFields: tablePermissionFieldsFor(resource).map(f => f.key), generatedAt: "2026-10-16T01:00:00Z", trendStart: "2026-10-09", trendEnd: "2026-10-15", orders: { orderCount: 5, unfinishedOrderCount: 3, orderRequiredQuantity: "500", orderCompletedQuantity: "300", orderPendingQuantity: "200", orderCompletionRate: ".6" }, plans: { requiredQuantity: "500", dispatchedWeeklyQuantity: "300", dispatchRate: ".6", cumulativeInboundQuantity: "250", pendingQuantity: "250", inboundRate: ".5", overdueCount: 125, exceptionCount: 125 }, readiness: [{ status: "待完善", count: 1, ratio: "1" }], auxiliary: ["technical", "hardware", "wood", "outsourcing"].map(key => ({ key, states: [{ status: "延期", count: 1 }, { status: "已完成", count: 2 }] })), processes: [...standardProcesses].reverse().map(p => ({ ...p, values: { requiredQuantity: "500", reportedQuantity: "525", productionProgress: "1.05" }, states: [{ status: "延期", count: 1 }, { status: "已完成", count: 2 }] })), trend: Array.from({ length: 7 }, (_, i) => ({ productionDate: `2026-10-${String(i + 9).padStart(2, "0")}`, ...Object.fromEntries(standardProcesses.map(p => [p.code + "ReportedQuantity", String(p.order + 10)])) })), divisions: Array.from({ length: 4 }, (_, i) => ({ divisionId: divisionId.slice(0, -2) + String(i + 10), divisionName: `合成事业部${i + 1}`, requiredQuantity: "125", dispatchedWeeklyQuantity: "75", cumulativeInboundQuantity: "62.5", pendingQuantity: "62.5", dispatchRate: ".6", inboundRate: ".5", overdueCount: 2, exceptionCount: 1 })) };
}
async function mount(page: Page, permissions = ["*"], mode = "data", path = "/master-plan-dashboard") {
  const user = { sub: "synthetic-cockpit-user", username: "synthetic", permissions, isSystemAdmin: permissions.includes("*"), tableDataScopes: [] };
  await page.addInitScript(u => { localStorage.setItem("accessToken", "synthetic-intercepted-token"); localStorage.setItem("sessionUser", JSON.stringify(u)); }, user);
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url()), name = url.pathname;
    if (name.endsWith("/auth/me")) return route.fulfill({ json: user });
    if (name.endsWith("/candidates")) return route.fulfill({ json: { options: url.searchParams.get("field") === "divisionId" ? [{ value: divisionId, label: "合成事业部1" }] : url.searchParams.get("field") === "orderNumber" ? [{ value: "SYN-ORDER", label: "SYN-ORDER" }, { value: "SYN-SECOND", label: "SYN-SECOND" }] : url.searchParams.get("field") === "itemCode" ? [{ value: "SYN-ITEM", label: "SYN-ITEM · 合成品名" }] : [{ value: "SYN-CUSTOMER", label: "合成客户" }], hasMore: false } });
    if (name.endsWith("/dashboard/summary")) {
      if (mode === "error") return route.fulfill({ status: 500, json: { message: "合成聚合查询错误" } });
      if (mode === "loading") await new Promise(resolve => setTimeout(resolve, 700));
      const data = fixture();
      if (mode === "empty" || mode === "hidden") { data.orders = {}; data.plans = {}; data.gaps = {}; data.readiness = []; data.divisions = []; data.trend = []; data.auxiliary = []; data.processes = data.processes.map(p => ({ ...p, values: {}, states: [] })); }
      if (mode === "hidden") data.visibleFields = [];
      return route.fulfill({ json: data });
    }
    if (name.endsWith("/dashboard/gap-counts")) return route.fulfill({ json: { gaps: fixture().gaps, visibleFields: fixture().visibleFields } });
    if (name.endsWith("/dashboard/export")) return route.fulfill({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers: { "content-disposition": `attachment; filename="mps_${url.searchParams.get("tableKey")!.replaceAll("-", "_")}_20261016.xlsx"` }, body: Buffer.from("synthetic-download") });
    if (name.endsWith("/dashboard/gaps") || name.includes("/dashboard/reports/") || name.endsWith("/dashboard/drill")) {
      const pageNo = Number(url.searchParams.get("page") || 1), size = Number(url.searchParams.get("pageSize") || 100), total = mode === "empty" ? 0 : 125;
      return route.fulfill({ json: { rows: Array.from({ length: Math.max(0, Math.min(size, total - (pageNo - 1) * size)) }, (_, i) => ({ id: `synthetic-${pageNo}-${i}`, resource: "mps-monthly-plans", divisionId, divisionName: "合成事业部1", orderNumber: `SYN-ORDER-${(pageNo - 1) * size + i + 1}`, itemCode: "SYN-ITEM", itemName: "合成品名", currentNode: "计划", currentStatus: "待处理", weeklyPlanState: "待完善", riskType: "已延期、生产异常", processName: "下料", processCode: "cutting", requiredQuantity: "500", productionProgress: "1.05", reportedQuantity: "525" })), total, page: pageNo, pageSize: size, visibleFields: fixture().visibleFields } });
    }
    if (name.includes("/master-plan-system/resources/") && name.endsWith("/meta")) return route.fulfill({ json: { fields: [{ key: "orderNumber", label: "订单号" }, { key: "itemCode", label: "品号" }] } });
    if (name.endsWith("/order-progress/meta")) return route.fulfill({ json: { visibleFields: tablePermissionFieldsFor("mps-order-progress-dashboard").map(f => f.key), canExport: false } });
    if (name.endsWith("/order-progress/orders")) return route.fulfill({ json: { rows: [], total: 0, page: 1, pageSize: 100, visibleFields: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto(path);
}
async function choose(page: Page, name: string, label: string) {
  const control = page.getByRole("combobox", { name, exact: true }); await control.focus();
  if (await control.getAttribute("aria-expanded") !== "true") await control.press("ArrowDown");
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option:visible .ant-select-item-option-content").getByText(label, { exact: true }).click();
  await control.press("Escape"); await expect(control).toHaveAttribute("aria-expanded", "false");
}
async function topScope(page: Page) {
  await choose(page, "事业部", "合成事业部1"); await choose(page, "客户", "合成客户"); await choose(page, "订单号", "SYN-ORDER"); await choose(page, "订单号", "SYN-SECOND"); await choose(page, "品号", "SYN-ITEM · 合成品名");
  await choose(page, "日期类型", "交付日期"); await choose(page, "日期周期", "按月"); const date = page.getByRole("textbox", { name: "日期值", exact: true }); await date.fill("2026-10"); await date.press("Enter"); await page.keyboard.press("Escape");
}
function assertScope(url: URL) {
  expect(url.searchParams.get("divisionId")).toBe(divisionId); expect(url.searchParams.get("customerCode")).toBe("SYN-CUSTOMER"); expect(JSON.parse(url.searchParams.get("orderNumbers")!)).toEqual(["SYN-ORDER", "SYN-SECOND"]); expect(JSON.parse(url.searchParams.get("itemCodes")!)).toEqual(["SYN-ITEM"]); expect(url.searchParams.get("dateType")).toBe("DELIVERY"); expect(url.searchParams.get("dateValue")).toBe("2026-10");
}
for (const width of [1366, 1440, 1920]) test(`desktop ${width}: original URL, cockpit charts, compact KPIs and single page scroll`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); const calls: URL[] = []; page.on("request", r => { if (r.url().includes("/dashboard/")) calls.push(new URL(r.url())); }); await mount(page);
  await expect(page.locator("header").getByText("PMC综合驾驶舱", { exact: true })).toBeVisible(); const dashboard = page.locator(".mps-cockpit");
  await expect(dashboard.locator(".mps-cockpit-core .ant-statistic")).toHaveCount(9); await expect(dashboard.getByText("PMC综合驾驶舱", { exact: true })).toHaveCount(0); await expect(dashboard.getByText(/本页面用于|实时掌握|统计日期/)).toHaveCount(0);
  await expect(dashboard.locator(".kdos-chart canvas")).toHaveCount(7); await expect(dashboard.getByRole("tab")).toHaveCount(0); await expect(dashboard.getByText("计划待完善明细", { exact: true })).toHaveCount(0);
  expect(calls.some(u => u.pathname.endsWith("/gaps") || u.pathname.includes("/reports/") || u.pathname.endsWith("/table"))).toBe(false);
  expect(await dashboard.evaluate(el => Array.from(el.querySelectorAll("*")).filter(e => ["auto", "scroll"].includes(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 30).length)).toBe(0);
  const core = dashboard.locator(".mps-cockpit-core"); await expect(core.getByText("订单整体完成率", { exact: true }).locator("..")).toContainText("60%");
  await page.getByText("工序执行汇总", { exact: true }).click(); for (const p of [...standardProcesses].sort((a, b) => a.order - b.order)) await expect(dashboard.getByRole("cell", { name: p.name, exact: true })).toBeVisible(); await expect(dashboard.getByText("105%", { exact: true })).toHaveCount(10);
  await page.setViewportSize({ width: width - 80, height: 900 }); await expect.poll(() => page.getByRole("img", { name: "标准工序生产进度", exact: true }).locator("canvas").evaluate(c => c.clientWidth)).toBeGreaterThan(300);
  await page.screenshot({ path: info.outputPath(`cockpit-${width}.png`), fullPage: true });
});
test("remote multi-scope refresh/clear applies to one summary and never changes production trend dates", async ({ page }) => {
  const calls: URL[] = []; page.on("request", r => { if (r.url().includes("/dashboard/")) calls.push(new URL(r.url())); }); await mount(page); await expect(page.getByText("订单概况（订单数）", { exact: true })).toBeVisible(); await topScope(page);
  await expect.poll(() => calls.filter(u => u.pathname.endsWith("/summary")).at(-1)?.searchParams.get("dateValue")).toBe("2026-10"); assertScope(calls.filter(u => u.pathname.endsWith("/summary")).at(-1)!);
  await expect(page.getByText("最近7天生产报工趋势（2026-10-09 ～ 2026-10-15）", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清空筛选", exact: true }).click(); await expect(page.getByRole("combobox", { name: "日期周期", exact: true })).toHaveCount(0);
  const refreshed = page.waitForRequest(r => new URL(r.url()).pathname.endsWith("/dashboard/summary") && !new URL(r.url()).searchParams.has("divisionId")); await page.getByRole("button", { name: "刷新数据", exact: true }).click(); await refreshed;
});
test("division comparisons separate quantity, percentage and risk; formal chart drill remains usable", async ({ page }) => {
  await mount(page); await expect(page.getByRole("img", { name: "事业部计划数量对比", exact: true }).locator("canvas")).toBeVisible(); await choose(page, "事业部对比指标", "比例"); await expect(page.getByRole("img", { name: "事业部计划比例对比", exact: true }).locator("canvas")).toBeVisible(); await choose(page, "事业部对比指标", "交付风险"); await expect(page.getByRole("img", { name: "事业部交付风险对比（月计划条数）", exact: true }).locator("canvas")).toBeVisible();
  const chart = page.getByRole("img", { name: "计划准备状态分布", exact: true }); await chart.scrollIntoViewIfNeeded();
  const request = page.waitForRequest(r => r.url().includes("/dashboard/drill?") && r.url().includes("resourceCode=mps-base-plans")); const box = await chart.boundingBox(); await chart.click({ position: { x: box!.width / 2, y: 160 } }); await request; await expect(page.getByRole("dialog")).toBeVisible();
});
test("risk summary navigates to exact accepted gap with all top scope and matching grain", async ({ page }) => {
  const calls: URL[] = []; page.on("request", r => { if (r.url().includes("/dashboard/gaps?")) calls.push(new URL(r.url())); }); await mount(page); await expect(page.getByText("交付风险摘要", { exact: true })).toBeVisible(); await topScope(page);
  const card = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title").getByText("交付风险摘要", { exact: true }) }); await card.getByRole("button", { name: "生产异常 125 月计划条", exact: true }).click();
  await expect(page).toHaveURL(/\/master-plan-gaps\?/); await expect(page.getByRole("tab", { name: "生产异常 125", exact: true })).toHaveAttribute("aria-selected", "true"); await expect.poll(() => calls.at(-1)?.searchParams.get("type")).toBe("production-exception"); assertScope(calls.at(-1)!);
});
test("order progress link carries explicit NONE while direct-open accepted defaults stay separate", async ({ page }) => {
  const calls: URL[] = []; page.on("request", r => { if (r.url().includes("/order-progress/orders?")) calls.push(new URL(r.url())); }); await mount(page); await page.getByRole("button", { name: "查看在制订单进度", exact: true }).click(); await expect(page).toHaveURL(/\/master-plan-order-progress\?/); await expect.poll(() => calls.length).toBeGreaterThan(0); expect(calls.at(-1)!.searchParams.get("dateType")).toBe("NONE"); expect(calls.at(-1)!.searchParams.has("dateValue")).toBe(false);
});
test("three report tables preserve independent page/search/sort/export with carried scope", async ({ page }) => {
  const calls: URL[] = []; page.on("request", r => { if (r.url().includes("/dashboard/")) calls.push(new URL(r.url())); }); await mount(page); await expect(page.getByText("订单概况（订单数）", { exact: true })).toBeVisible(); await topScope(page); await page.getByRole("button", { name: "查看PMC分析明细报表", exact: true }).click(); await expect(page).toHaveURL(/\/master-plan-reports\?/);
  const tables = [["计划待完善明细", "plan-readiness"], ["工序执行明细", "process-execution"], ["风险与异常", "risk-exception"]] as const;
  for (const [title, key] of tables) {
    const card = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title").getByText(title, { exact: true }) }); await expect(card.locator("tr.ant-table-row")).toHaveCount(100); assertScope(calls.filter(u => u.pathname.endsWith("/reports/" + key)).at(-1)!);
    const download = page.waitForEvent("download"); await card.getByRole("button", { name: "导出", exact: true }).click(); expect((await download).suggestedFilename()).toMatch(new RegExp(`^mps_${key.replaceAll("-", "_")}_\\d{8}\\.xlsx$`)); assertScope(calls.findLast(u => u.pathname.endsWith("/export"))!);
  }
  const first = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title").getByText("计划待完善明细", { exact: true }) }); await first.locator(".ant-pagination-item-2").click(); await expect(first.getByRole("cell", { name: "SYN-ORDER-101", exact: true })).toBeVisible();
  await first.getByRole("columnheader", { name: "订单号", exact: false }).click(); const input = first.getByRole("searchbox", { name: "计划待完善明细搜索", exact: true }); await input.fill("SYN-ORDER"); await input.press("Enter");
  await expect.poll(() => calls.filter(u => u.pathname.endsWith("/reports/plan-readiness")).at(-1)?.searchParams.get("search")).toBe("SYN-ORDER"); expect(calls.filter(u => u.pathname.endsWith("/reports/plan-readiness")).at(-1)!.searchParams.get("page")).toBe("1");
  for (const key of ["process-execution", "risk-exception"]) { const u = calls.filter(u => u.pathname.endsWith("/reports/" + key)).at(-1)!; expect(u.searchParams.get("page")).toBe("1"); expect(u.searchParams.has("search")).toBe(false); }
  await first.getByRole("cell", { name: "SYN-ORDER-30", exact: true }).scrollIntoViewIfNeeded(); const sticky = first.locator(".ant-table-sticky-holder"); await expect(sticky).toBeVisible(); expect((await sticky.boundingBox())!.y).toBeGreaterThanOrEqual(0);
});
test("division and original ten-process aggregate tables export their own full scope", async ({ page }) => {
  const calls: URL[] = []; page.on("request", r => { if (r.url().includes("/dashboard/export?")) calls.push(new URL(r.url())); }); await mount(page); await expect(page.getByText("事业部计划与执行汇总", { exact: true })).toBeVisible(); await topScope(page);
  const division = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title").getByText("事业部计划与执行汇总", { exact: true }) }); let download = page.waitForEvent("download"); await division.getByRole("button", { name: "导出", exact: true }).click(); expect((await download).suggestedFilename()).toMatch(/^mps_division_summary_\d{8}\.xlsx$/); assertScope(calls.at(-1)!);
  await page.getByText("工序执行汇总", { exact: true }).click(); download = page.waitForEvent("download"); await page.locator(".ant-collapse-content-active").getByRole("button", { name: "导出", exact: true }).click(); expect((await download).suggestedFilename()).toMatch(/^mps_process_summary_\d{8}\.xlsx$/); assertScope(calls.at(-1)!);
});
test("no overview read blocks cockpit/reports; overview read alone cannot enter order progress", async ({ page }) => {
  let calls = 0; page.on("request", r => { if (r.url().includes("/master-plan-system/dashboard")) calls++; }); await mount(page, ["mps-monthly-plans:*:read"]); await expect(page).toHaveURL(/\/$/); expect(calls).toBe(0);
  await page.goto("/master-plan-reports?from=pmc-cockpit&dateType=NONE"); await expect(page).toHaveURL(/\/$/); expect(calls).toBe(0);
  await page.unrouteAll(); await mount(page, [resource + ":*:read"]); await expect(page.getByText("订单概况（订单数）", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "查看在制订单进度", exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "导出", exact: true })).toHaveCount(0);
  await page.goto("/master-plan-order-progress?from=pmc-cockpit&dateType=NONE"); await expect(page).toHaveURL(/\/$/);
});
test("risk report still opens original authorized detail with server pagination", async ({ page }) => {
  await mount(page, ["*"], "data", "/master-plan-reports"); const risk = page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title").getByText("风险与异常", { exact: true }) }); await risk.getByRole("button", { name: "SYN-ORDER-1", exact: true }).click(); const dialog = page.getByRole("dialog"); await expect(dialog.getByRole("cell", { name: "SYN-ORDER-1", exact: true })).toBeVisible(); await dialog.locator(".ant-pagination-item-2").click(); await expect(dialog.getByRole("cell", { name: "SYN-ORDER-101", exact: true })).toBeVisible();
});
test("malformed cross-screen scope is blocked before target data requests", async ({ page }) => {
  let calls = 0; page.on("request", r => { if (r.url().includes("/api/v1/master-plan-system/")) calls++; }); await mount(page, ["*"], "data", "/master-plan-gaps?from=pmc-cockpit&dateType=ORDER&datePeriod=DAY&dateValue=2026-02-30"); await expect(page.getByText(/链接筛选条件无效/)).toBeVisible(); expect(calls).toBe(0);
});
test("empty, hidden, loading and errors do not fabricate zero progress or risk", async ({ page }) => {
  await mount(page, ["*"], "loading"); await expect(page.getByLabel("加载中", { exact: true })).toBeVisible(); await expect(page.getByText("订单概况（订单数）", { exact: true })).toBeVisible();
  await page.unrouteAll(); await mount(page, ["*"], "empty"); await expect(page.getByRole("img", { name: "标准工序生产进度", exact: true })).toContainText("暂无数据");
  await page.unrouteAll(); await mount(page, ["*"], "hidden"); await expect(page.locator(".mps-cockpit-core").getByText("暂无可见指标", { exact: true })).toBeVisible(); await expect(page.getByRole("combobox", { name: "订单号", exact: true })).toHaveCount(0);
  await page.unrouteAll(); await mount(page, ["*"], "error"); await expect(page.getByText("合成聚合查询错误", { exact: true })).toBeVisible();
});
