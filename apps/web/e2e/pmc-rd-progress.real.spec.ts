import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// This suite uses an existing account. Disable all browser artifacts that could record identity or tokens.
test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15_000 });
test.setTimeout(120_000);
const enabled = Boolean(process.env.PMC_E2E_USERNAME && process.env.PMC_E2E_PASSWORD);
const basePath = "/pmc/reports/rd-progress";
async function login(page: Page) {
  await page.goto("/");
  // Suppress sensitive input values in failure call logs; no actual credentials are present in this file.
  try {
    await page.getByLabel("用户名").fill(process.env.PMC_E2E_USERNAME!);
    await page.getByLabel("密码").fill(process.env.PMC_E2E_PASSWORD!);
    await page.locator('button[type="submit"]').click();
  } catch { throw new Error("E2E login input failed (credentials suppressed)"); }
  await expect(page.locator(".portal-module-grid")).toBeVisible();
}
async function read<T = any>(page: Page, path: string): Promise<T> {
  return page.evaluate(async apiPath => {
    const response = await fetch(`/api/v1${apiPath}`, { headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` } });
    if (!response.ok) throw new Error(`Read-only acceptance HTTP ${response.status}`);
    return response.json();
  }, path);
}
async function applied(page: Page) {
  await expect.poll(() => new URL(page.url()).searchParams.get("orderDateFrom")).not.toBeNull();
  const params = new URL(page.url()).searchParams; params.delete("period"); params.delete("periodValue"); params.delete("tab"); return params;
}
async function openSelect(page: Page, label: string) {
  // Non-searchable Ant Select overlays its readonly input with the selected label.
  await page.locator(".ant-select").filter({ has: page.getByRole("combobox", { name: label, exact: true }) }).click();
}
async function choosePeriod(page: Page, label: string, value: string, end?: string) {
  await openSelect(page, "日期周期");
  await page.locator(".ant-select-dropdown:visible").getByText(label, { exact: true }).click();
  const inputs = page.locator(".pmc-rd-date-filter input");
  // Picker inputs commit calendar strings, without creating UTC dates.
  await inputs.nth(1).fill(value);
  if (end) { await inputs.nth(1).press("Tab"); await inputs.nth(2).fill(end); await inputs.nth(2).press("Enter"); }
  else await inputs.nth(1).press("Enter");
  await page.getByRole("button", { name: /^查\s*询$/ }).click();
}
const cases = [
  ["2304-202610060005", "601000110", "不适用", "NOT_APPLICABLE"],
  ["2301-2026C1101-B061", "ABL370CC0C375-1/1", "未开始", "NOT_STARTED"],
  ["2307-260930008", "RXA500J-V5-1/1", "待工艺", "WAITING_ROUTING"],
  ["2307-260930008", "RXA505F-HLLV5-1/1", "研发完成", "COMPLETE"]
] as const;
test.describe("PMC研发进度现有账号生产页面验收", () => {
  test.skip(!enabled, "Requires runtime PMC E2E credentials; no account creation or permission changes.");
  test("登录、导航、生产汇总、七种状态总和与默认分页", async ({ page }) => {
    await login(page); await page.goto(basePath);
    await expect(page.getByRole("heading", { name: "研发进度", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "图表看板" })).toHaveAttribute("aria-selected", "true");
    const params = await applied(page);
    const summary = await read(page, `${basePath}/summary?${params}`);
    const items = await read(page, `${basePath}/items?${params}&page=1&pageSize=100`);
    await expect(page.locator(".kdos-data-table-shell")).toHaveCount(0);
    expect(Object.values(summary.statusCounts).reduce((sum: number, count) => sum + Number(count), 0)).toBe(items.total);
    expect(summary.itemCount).toBe(items.total); expect(items.rows.length).toBe(Math.min(100, items.total));
    await expect(page.locator(".pmc-rd-kpis")).toContainText(String(summary.itemCount));
    await expect(page.locator(".pmc-rd-kpis")).toContainText(`${summary.overallCompletionRate}%`);
    await expect(page.getByText("同步成功", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /进入编辑模式|新增|全量同步|增量同步/ })).toHaveCount(0);
    const sidebar = page.locator(".ant-layout-sider"); await sidebar.getByText("报表", { exact: true }).click();
    await expect(sidebar.getByText("研发进度", { exact: true })).toBeVisible();
    await writeFile(resolve("../../outputs/pmc-phase51-browser-summary.json"), JSON.stringify({ loginPermission: "PASS", summary, detailTotal: items.total, pageSize: 100 }, null, 2));
  });
  for (const [orderNo, itemCode, label, status] of cases) {
    test(`业务样本 ${orderNo} / ${itemCode}`, async ({ page }) => {
      await login(page); await page.goto(`${basePath}?period=year&periodValue=2026&tab=detail`);
      await page.getByPlaceholder("请输入订单号").fill(orderNo);
      await page.getByPlaceholder("请输入品项编码").fill(itemCode);
      await page.getByRole("button", { name: /^查\s*询$/ }).click();
      const row = page.locator(".ant-table-tbody tr").filter({ hasText: itemCode }).first();
      await expect(row).toBeVisible(); await expect(row.locator('.ant-tag').last()).toContainText(label);
      const data = await read(page, `${basePath}/items?${new URLSearchParams({ orderNo, itemCode })}`);
      expect(data.rows.find((entry: any) => entry.itemCode === itemCode)?.rdStatus).toBe(status);
      await row.getByRole("button", { name: orderNo, exact: true }).click();
      const drawer = page.getByRole("dialog"); await expect(drawer).toContainText("订单研发详情");
      await expect(drawer.getByText("订单完成率", { exact: true })).toBeVisible();
      const allOrderItems = await read(page, `${basePath}/items?filterGroup=${encodeURIComponent(JSON.stringify({ logic: "AND", rules: [{ field: "sourceOrderId", operator: "eq", value: data.rows[0].sourceOrderId }] }))}`);
      await expect(drawer.getByText(`共 ${allOrderItems.total} 条`, { exact: true })).toBeVisible();
      await drawer.locator(".ant-drawer-close").click();
      await expect.poll(() => new URL(page.url()).searchParams.get("itemCode")).toBe(itemCode);
    });
  }
  test("仅未完成、异常原因、URL恢复和筛选导出超过当前页", async ({ page }) => {
    await login(page); await page.goto(`${basePath}?period=year&periodValue=2026`);
    await page.getByRole("button", { name: "筛选未完成品项" }).click();
    await expect(page).toHaveURL(/onlyIncomplete=true/);
    const params = await applied(page);
    await page.getByRole("tab", { name: "明细报表" }).click();
    const filtered = await read(page, `${basePath}/items?${params}&pageSize=100`);
    expect(filtered.total).toBeGreaterThan(filtered.rows.length);
    const exported = page.waitForResponse(response => response.url().includes("/table-exports/pmc-rd-progress?") && response.ok());
    const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: /导\s*出/ }).click();
    const download = await downloadPromise; expect(download.suggestedFilename()).toBe("pmc-rd-progress.xlsx"); expect(await download.failure()).toBeNull();
    const response = await exported;
    const context = JSON.parse(new URL(response.url()).searchParams.get("context")!); expect(context.onlyIncomplete).toBe("true"); expect(context.orderDateFrom).toBe("2026-01-01"); expect(context.orderDateTo).toBe("2026-12-31");
    const columns = new URL(response.url()).searchParams.get("columnKeys")!; expect(columns).not.toContain("sourceOrderLineId");
    // Count XLSX rows using the already installed API ExcelJS library. The workbook holds business fields only.
    const { default: ExcelJS } = await import("../../api/node_modules/exceljs/excel.js");
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await readFile((await download.path())!)); expect(book.worksheets[0].rowCount - 1).toBe(filtered.total);
    await writeFile(resolve("../../outputs/pmc-phase51-export.json"), JSON.stringify({ filter: Object.fromEntries(params), pageSize: 100, total: filtered.total, exportedRows: book.worksheets[0].rowCount - 1, filename: download.suggestedFilename(), headers: book.worksheets[0].getRow(1).values }, null, 2));
    await page.reload(); await expect(page.locator(".ant-select").filter({ has: page.getByRole("combobox", { name: "未完成", exact: true }) })).toContainText("只看未完成");
    await page.getByRole("tab", { name: "图表看板" }).click();
    await page.getByRole("button", { name: "筛选异常品项" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("rdStatus")).toBe("ABNORMAL");
    const abnormal = await read(page, `${basePath}/items?${await applied(page)}`); expect(abnormal.total).toBeGreaterThan(0);
    await expect(page.locator(".pmc-rd-status-filters")).toContainText(/异\s*常/);
    await page.getByRole("tab", { name: "明细报表" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("rdStatus")).toBe("ABNORMAL");
    for (const entry of abnormal.rows) { const row = page.locator(".ant-table-tbody tr").filter({ hasText: entry.itemCode }).first(); await expect(row).toContainText(entry.reasonText); }
  });
  test("客户/事业部/品项/环节/日期组合筛选与汇总一致", async ({ page }) => {
    await login(page); await page.goto(basePath);
    const baseline = await read(page, `${basePath}/items?pageSize=100`);
    const item = baseline.rows.find((entry: any) => entry.customerName && entry.divisionId) ?? baseline.rows[0];
    const params = new URLSearchParams({ orderNo: item.orderNo, itemCode: item.itemCode, itemName: item.itemName, rdStatus: item.rdStatus, designBomStatus: item.designBomStatus, routingStatus: item.routingStatus, orderDateFrom: item.orderDate.slice(0, 10), orderDateTo: item.orderDate.slice(0, 10) });
    if (item.customerName) params.set("customer", item.customerName);
    if (item.divisionId) params.set("division", item.divisionId);
    const response = page.waitForResponse(response => response.url().includes(`${basePath}/items?`) && response.ok());
    params.set("tab", "detail"); await page.goto(`${basePath}?${params}`); const result = await (await response).json();
    expect(result.total).toBeGreaterThan(0);
    for (const entry of result.rows) { expect(entry.orderNo).toContain(item.orderNo); expect(entry.itemCode).toContain(item.itemCode); expect(entry.designBomStatus).toBe(item.designBomStatus); expect(entry.routingStatus).toBe(item.routingStatus); if(item.divisionId) expect(entry.divisionId).toBe(item.divisionId); }
    const summary = await read(page, `${basePath}/summary?${params}`); expect(summary.itemCount).toBe(result.total);
    await expect(page.getByPlaceholder("请输入订单号")).toHaveValue(item.orderNo);
    await page.getByRole("button", { name: /^查\s*询$/ }).click(); await expect.poll(() => new URL(page.url()).searchParams.get("orderDateFrom")).toBe(item.orderDate.slice(0, 10));
  });
  test("两个桌面尺寸、横向滚动、sticky表头与前后分页", async ({ page }) => {
    await login(page); await page.goto(basePath);
    for (const width of [1920, 1366]) {
      await page.setViewportSize({ width, height: 900 }); await expect(page.locator(".pmc-rd-kpis")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.goto(`${basePath}?period=year&periodValue=2026&tab=detail`);
    await page.getByTitle("2", { exact: true }).click(); await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
    await page.getByRole("tab", { name: "图表看板" }).click();
    await page.getByRole("button", { name: "筛选已完成品项" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("rdStatus")).toBe("COMPLETE");
    await page.getByRole("tab", { name: "明细报表" }).click(); await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
    const table = page.locator(".kdos-data-table-shell"); await table.scrollIntoViewIfNeeded();
    await page.evaluate(() => { const main = document.querySelector(".app-page-scroll"); if (main) main.scrollTop += 400; else window.scrollBy(0, 400); });
    const head = page.locator(".ant-table-sticky-holder").first(); await expect(head).toBeVisible();
    const box = await head.boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y).toBeLessThanOrEqual(1);
  });
  test("未认证接口拒绝；登录账号字段与数据范围由真实API裁剪", async ({ page, request }) => {
    for (const path of ["items", "summary", "orders", "sync-status"]) expect((await request.get(`/api/v1${basePath}/${path}`)).status()).toBe(401);
    expect((await request.get("/api/v1/table-exports/pmc-rd-progress")).status()).toBe(401);
    await login(page); await page.goto(basePath);
    const result = await page.evaluate(async () => {
      const token = localStorage.getItem("accessToken");
      const headers = { Authorization: `Bearer ${token}` };
      const session = await (await fetch("/api/v1/auth/me", { headers })).json();
      const items = await (await fetch("/api/v1/pmc/reports/rd-progress/items?pageSize=50", { headers })).json();
      const summary = await (await fetch("/api/v1/pmc/reports/rd-progress/summary", { headers })).json();
      const admin = session.isSystemAdmin || session.permissions.includes("*") || session.moduleAdminCodes?.includes("planning");
      const unauthorized = admin ? [] : Object.keys(items.rows[0] ?? {}).filter(field => !["id", "version"].includes(field) && !session.permissions.includes(`pmc-rd-progress:${field}:read`));
      return { unauthorized, itemCount: summary.itemCount, total: items.total };
    });
    expect(result.unauthorized).toEqual([]); expect(result.itemCount).toBe(result.total);
  });
  test("默认上海昨天、重置及刷新恢复", async ({ page }) => {
    await login(page); await page.goto(basePath);
    const yesterday = await page.evaluate(() => {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      const get = (key: string) => parts.find(part => part.type === key)!.value;
      const date = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00+08:00`);
      return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date.valueOf() - 86400000));
    });
    await expect.poll(() => new URL(page.url()).searchParams.get("periodValue")).toBe(yesterday);
    await expect(page.getByRole("textbox", { name: "统计日期" })).toHaveValue(yesterday);
    await choosePeriod(page, "按年", "2026"); await expect.poll(() => new URL(page.url()).searchParams.get("period")).toBe("year");
    await page.getByRole("button", { name: /^重\s*置$/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("periodValue")).toBe(yesterday);
    await page.reload(); await expect(page.getByRole("textbox", { name: "统计日期" })).toHaveValue(yesterday);
  });
  for (const [label, value, end, from, to] of [
    ["按日", "2026-10-05", undefined, "2026-10-05", "2026-10-05"],
    ["按月", "2026-09", undefined, "2026-09-01", "2026-09-30"],
    ["按年", "2026", undefined, "2026-01-01", "2026-12-31"],
    ["自定义", "2026-09-01", "2026-10-07", "2026-09-01", "2026-10-07"]
  ] as const) {
    test(`实际周期选择 ${label}`, async ({ page }) => {
      await login(page); await page.goto(basePath);
      await choosePeriod(page, label, value, end);
      await expect.poll(() => new URL(page.url()).searchParams.get("orderDateFrom")).toBe(from);
      await expect.poll(() => new URL(page.url()).searchParams.get("orderDateTo")).toBe(to);
      const params = await applied(page); const summary = await read(page, `${basePath}/summary?${params}`);
      const items = await read(page, `${basePath}/items?${params}`);
      expect(summary.itemCount).toBe(items.total);
      expect(Object.values(summary.statusCounts).reduce((sum: number, n) => sum + Number(n), 0)).toBe(items.total);
      await expect(page.locator(".pmc-rd-kpis")).toContainText(String(items.total));
      await page.reload(); await expect.poll(() => new URL(page.url()).searchParams.get("orderDateFrom")).toBe(from);
    });
  }
  test("事业四部/客户搜索/未完成跨Tab保持，完整组合筛选实际Excel", async ({ page }) => {
    await login(page); await page.goto(`${basePath}?period=year&periodValue=2026`);
    const candidates = await read(page, "/table-filters/candidates?resource=pmc-rd-progress&field=divisionId&limit=100&withMeta=1");
    expect(candidates.options.some((entry: any) => entry.label.includes("事业四部"))).toBe(true);
    await openSelect(page, "事业部");
    await page.locator(".ant-select-dropdown:visible").getByText(/事业四部/).click();
    await openSelect(page, "未完成");
    await page.locator(".ant-select-dropdown:visible").getByText("只看未完成", { exact: true }).click();
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("division")).not.toBeNull();
    const params = await applied(page); const summary = await read(page, `${basePath}/summary?${params}`);
    await page.getByRole("tab", { name: "明细报表" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("division")).toBe(params.get("division"));
    const items = await read(page, `${basePath}/items?${params}`); expect(items.total).toBe(summary.itemCount); expect(items.total).toBeGreaterThan(0);
    for (const row of items.rows) { expect(row.divisionName).toBe("事业四部"); expect(["COMPLETE", "NOT_APPLICABLE"]).not.toContain(row.rdStatus); }
    // Apply the third status dimension and verify the same context reaches the existing export API.
    await openSelect(page, "研发状态");
    const chosenStatus = items.rows[0].rdStatus;
    const labels: Record<string, string> = { NOT_STARTED: "未开始", DESIGN_IN_PROGRESS: "设计 BOM 进行中", WAITING_ROUTING: "待工艺", ROUTING_IN_PROGRESS: "工艺设计中", ABNORMAL: "异常" };
    await page.locator(".ant-select-dropdown:visible").getByText(labels[chosenStatus], { exact: true }).click();
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("rdStatus")).toBe(chosenStatus);
    const current = await applied(page); const filtered = await read(page, `${basePath}/items?${current}&pageSize=100`);
    const responsePromise = page.waitForResponse(response => response.url().includes("/table-exports/pmc-rd-progress?") && response.ok());
    const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: /导\s*出/ }).click();
    const download = await downloadPromise; const response = await responsePromise;
    const context = JSON.parse(new URL(response.url()).searchParams.get("context")!);
    for (const [key, value] of current) expect(context[key]).toBe(value);
    const { default: ExcelJS } = await import("../../api/node_modules/exceljs/excel.js");
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await readFile((await download.path())!));
    const sheet = book.worksheets[0]; expect(sheet.rowCount - 1).toBe(filtered.total);
    const headers = sheet.getRow(1).values as Array<string>;
    for (let index = 2; index <= sheet.rowCount; index++) {
      const excelRow = sheet.getRow(index);
      expect(String(excelRow.getCell(headers.indexOf("事业部")).value)).toContain("事业四部");
      expect(excelRow.getCell(headers.indexOf("研发状态")).value).toBe(labels[chosenStatus]);
      const date = String(excelRow.getCell(headers.indexOf("下单日期")).value);
      expect(date >= current.get("orderDateFrom")! && date <= current.get("orderDateTo")!).toBe(true);
    }
    await writeFile(resolve("../../outputs/pmc-phase51-division-export.json"), JSON.stringify({ filters: Object.fromEntries(current), pageRows: filtered.rows.length, total: filtered.total, exportedRows: book.worksheets[0].rowCount - 1, filename: download.suggestedFilename() }, null, 2));
    // Search candidates dynamically; no free-text customer filter or hard-coded customer list.
    const customer = filtered.rows.find((row: any) => row.customerName)?.customerName;
    if (customer) {
      await openSelect(page, "客户");
      const customerCandidates = page.waitForResponse(response => response.url().includes("field=customerName") && response.url().includes("search=") && response.ok());
      await page.getByRole("combobox", { name: "客户" }).fill(customer); await customerCandidates;
      await page.locator(".ant-select-dropdown:visible").getByText(customer, { exact: true }).first().click();
      await page.getByRole("button", { name: /^查\s*询$/ }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get("customer")).toBe(customer);
    }
  });
});
