import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// This suite uses an existing account. Disable all browser artifacts that could record identity or tokens.
test.use({ trace: "off", screenshot: "off", video: "off" });
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
    const summary = await read(page, `${basePath}/summary`);
    const items = await read(page, `${basePath}/items?page=1&pageSize=100`);
    expect(Object.values(summary.statusCounts).reduce((sum: number, count) => sum + Number(count), 0)).toBe(items.total);
    expect(summary.itemCount).toBe(items.total); expect(items.rows.length).toBe(Math.min(100, items.total));
    await expect(page.locator(".pmc-rd-kpis")).toContainText(String(summary.itemCount));
    await expect(page.locator(".pmc-rd-kpis")).toContainText(`${summary.overallCompletionRate}%`);
    await expect(page.getByText("同步成功", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /进入编辑模式|新增|全量同步|增量同步/ })).toHaveCount(0);
    const sidebar = page.locator(".ant-layout-sider"); await sidebar.getByText("报表", { exact: true }).click();
    await expect(sidebar.getByText("研发进度", { exact: true })).toBeVisible();
    await writeFile(resolve("../../outputs/pmc-phase5-browser-summary.json"), JSON.stringify({ loginPermission: "PASS", summary, detailTotal: items.total, pageSize: 100 }, null, 2));
  });
  for (const [orderNo, itemCode, label, status] of cases) {
    test(`业务样本 ${orderNo} / ${itemCode}`, async ({ page }) => {
      await login(page); await page.goto(basePath);
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
    await login(page); await page.goto(basePath);
    await page.getByRole("button", { name: "筛选未完成品项" }).click();
    await expect(page).toHaveURL(/onlyIncomplete=true/);
    const filtered = await read(page, `${basePath}/items?onlyIncomplete=true&pageSize=100`);
    expect(filtered.total).toBeGreaterThan(filtered.rows.length);
    const exported = page.waitForResponse(response => response.url().includes("/table-exports/pmc-rd-progress?") && response.ok());
    const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: /^导\s*出$/ }).click();
    const download = await downloadPromise; expect(download.suggestedFilename()).toBe("pmc-rd-progress.xlsx"); expect(await download.failure()).toBeNull();
    const response = await exported;
    const context = JSON.parse(new URL(response.url()).searchParams.get("context")!); expect(context.onlyIncomplete).toBe("true");
    const columns = new URL(response.url()).searchParams.get("columnKeys")!; expect(columns).not.toContain("sourceOrderLineId");
    // Count XLSX rows using the already installed API ExcelJS library. The workbook holds business fields only.
    const { default: ExcelJS } = await import("../../api/node_modules/exceljs/excel.js");
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.body()); expect(book.worksheets[0].rowCount - 1).toBe(filtered.total);
    await page.reload(); await expect(page.getByLabel("仅未完成")).toBeChecked();
    await page.getByRole("button", { name: "筛选异常品项" }).click();
    const abnormal = await read(page, `${basePath}/items?rdStatus=ABNORMAL`); expect(abnormal.total).toBeGreaterThan(0);
    for (const entry of abnormal.rows) { const row = page.locator(".ant-table-tbody tr").filter({ hasText: entry.itemCode }).first(); await expect(row).toContainText(entry.reasonText); }
    await expect(page.locator(".pmc-rd-status-filters")).toContainText("异常");
  });
  test("客户/事业部/品项/环节/日期组合筛选与汇总一致", async ({ page }) => {
    await login(page); await page.goto(basePath);
    const baseline = await read(page, `${basePath}/items?pageSize=100`);
    const item = baseline.rows.find((entry: any) => entry.customerName && entry.divisionId) ?? baseline.rows[0];
    const params = new URLSearchParams({ orderNo: item.orderNo, itemCode: item.itemCode, itemName: item.itemName, rdStatus: item.rdStatus, designBomStatus: item.designBomStatus, routingStatus: item.routingStatus, orderDateFrom: item.orderDate.slice(0, 10), orderDateTo: item.orderDate.slice(0, 10) });
    if (item.customerName) params.set("customer", item.customerName);
    if (item.divisionId) params.set("division", item.divisionId);
    const response = page.waitForResponse(response => response.url().includes(`${basePath}/items?`) && response.ok());
    await page.goto(`${basePath}?${params}`); const result = await (await response).json();
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
    await page.getByTitle("2", { exact: true }).click(); await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
    await page.getByRole("button", { name: "筛选已完成品项" }).click(); await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
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
});
