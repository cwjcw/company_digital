import { expect, test, type Page } from "@playwright/test";

/**
 * KN-PRINT-001 浏览器 UAT：真实 Chrome 中触发标准表格打印，验证 Dedicated Print DOM + 打印 CSS + 浏览器打印流程。
 * Playwright 无法读取系统打印窗口，因此断言打印 DOM（标题/范围/方向/表头/数据）与实际触发的 window.print。
 */
const username = process.env.KNP_E2E_USERNAME ?? "__knp_admin";
const password = process.env.KNP_E2E_PASSWORD ?? "";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("accessToken")))).toBe(true);
}

/**
 * 已知问题（KN-PRINT-001 收尾遗留）：确认弹窗路径（>300 行）在自动化 UAT 中未能稳定通过。
 * 手工/API 验证：manifest 返回真实条数、确认弹窗会出现（单次调试脚本可见 .ant-modal=1）、取消后不请求 render。
 * 为了不掩盖问题，这三条用例保持可执行但标记为 fixme，待收尾修复后再启用。
 */
test.describe("KN-PRINT-001 统一表格打印", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!password, "缺少 KNP_E2E_PASSWORD");

  test("Master Plan 宽表：打印筛选结果生成打印 DOM（含标题/范围/方向/表头）", async ({ page }, testInfo) => {
    await login(page);
    await page.addInitScript(() => { (window as unknown as { __printed?: number }).__printed = 0; window.print = () => { (window as unknown as { __printed?: number }).__printed = ((window as unknown as { __printed?: number }).__printed ?? 0) + 1; }; });
    await page.goto("/master-plan-system/mps-weekly-plans");
    await expect(page.getByRole("heading", { name: "事业部周计划" }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /打印筛选结果/ }).click();
    const root = page.locator(".kdos-print-root");
    await expect(page.getByTestId("kdos-print-preview")).toBeVisible({ timeout: 30_000 });
    await expect(root.locator(".kdos-print-title")).toHaveText("事业部周计划");
    await expect(root.locator(".kdos-print-scope")).toContainText("打印范围");
    await expect(root.locator("table thead")).toBeVisible();
    await expect(root).toHaveClass(/orientation-(landscape|portrait)/);
    /* 预览可切换方向，然后调用浏览器打印。 */
    await page.getByRole("button", { name: /切换为/ }).click();
    await page.getByTestId("kdos-print-preview").getByRole("button", { name: "打印" }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed?: number }).__printed)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("master-plan-print.png") });
  });

  test("Data Center 大表：超过阈值先确认，取消不加载数据", async ({ page }) => {
    await login(page);
    await page.goto("/data-center/sales-orders");
    await expect(page.getByRole("heading", { name: "订单表" }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /打印筛选结果/ }).click();
    const modal = page.locator(".ant-modal").filter({ hasText: "确认打印" });
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await expect(modal).toContainText(/建议进一步筛选后再打印|打印内容较多/);
    await modal.getByRole("button", { name: "取消" }).click();
    await expect(page.getByTestId("kdos-print-preview")).toHaveCount(0);
  });

  test("Users：页面上下文（部门/状态）随打印请求下发", async ({ page }) => {
    await login(page);
    const calls: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/table-prints/")) calls.push(decodeURIComponent(request.url())); });
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "用户与角色" }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /打印筛选结果/ }).click();
    const modal = page.locator(".ant-modal").filter({ hasText: "确认打印" });
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await modal.getByRole("button", { name: /继续打印/ }).click();
    await expect(page.getByTestId("kdos-print-preview")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".kdos-print-root .kdos-print-title")).toHaveText("用户与角色");
    const render = calls.filter((url) => url.includes("/table-prints/render"));
    expect(render.length).toBeGreaterThan(0);
  });

  test("跨页选择：打印已选（跨页稳定 ID）", async ({ page }) => {
    await login(page);
    await page.goto("/equipment-register");
    await expect(page.getByRole("heading", { name: "设备总台账" })).toBeVisible({ timeout: 20_000 });
    const rows = page.locator(".kdos-data-table-shell .ant-table-tbody tr.ant-table-row");
    await rows.nth(0).locator(".ant-checkbox-input").click();
    /* 翻页后再选一条：选择状态必须按稳定 ID 保留。 */
    await page.locator(".ant-pagination-next button").first().click();
    await page.waitForTimeout(800);
    await rows.nth(0).locator(".ant-checkbox-input").click();
    const printSelected = page.getByRole("button", { name: /打印已选（2）/ });
    await expect(printSelected).toBeVisible();
    await printSelected.click();
    const modal = page.locator(".ant-modal").filter({ hasText: "确认打印" });
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await modal.getByRole("button", { name: /继续打印/ }).click();
    const root = page.locator(".kdos-print-root");
    await expect(page.getByTestId("kdos-print-preview")).toBeVisible({ timeout: 30_000 });
    await expect(root.locator(".kdos-print-scope")).toContainText("已选，共 2 条");
    await expect(root.locator("tbody tr")).toHaveCount(2);
  });
});

/** 选中 1 条：同一个主打印入口变成「打印已选（1）」，预览只打印这 1 条。 */
const SELECT_ONE_PAGES: Array<[string, string, string]> = [
  ["Master Plan", "/master-plan-system/mps-weekly-plans", "事业部周计划"],
  ["Equipment", "/equipment-register", "设备总台账"],
  ["Data Center", "/data-center/sales-orders", "订单表"],
  ["Marketing", "/marketing/order-schedule", "订单排期"],
  ["Users", "/users", "用户与角色"]
];

test.describe("KN-PRINT-001 选中优先（选 1 条只打印 1 条）", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!password, "缺少 KNP_E2E_PASSWORD");

  for (const [label, path, title] of SELECT_ONE_PAGES) {
    test(`${label}：选 1 条 → 打印已选（1） → 预览 1 行`, async ({ page }, testInfo) => {
      await login(page);
      await page.goto(path);
      await expect(page.getByRole("heading", { name: title }).first()).toBeVisible({ timeout: 20_000 });
      const shell = page.locator(".kdos-data-table-shell").first();
      /* 未选择时只有一个「打印筛选结果」。 */
      await expect(shell.getByRole("button", { name: /打印筛选结果/ })).toBeVisible({ timeout: 20_000 });
      await expect(shell.getByRole("button", { name: /打印已选/ })).toHaveCount(0);
      /* 勾选第一条后：同一个按钮变成「打印已选（1）」，不再出现“打印筛选结果”。 */
      await shell.locator(".ant-table-tbody tr.ant-table-row").first().locator(".ant-checkbox-input").click();
      const selectedButton = shell.getByRole("button", { name: /打印已选（1）/ });
      await expect(selectedButton).toBeVisible();
      await expect(shell.getByRole("button", { name: /打印筛选结果/ })).toHaveCount(0);
      await selectedButton.click();
      const confirm = page.locator(".ant-modal").filter({ hasText: "确认打印" });
      if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /继续打印/ }).click();
      const root = page.locator(".kdos-print-root");
      await expect(page.getByTestId("kdos-print-preview")).toBeVisible({ timeout: 60_000 });
      await expect(root.locator(".kdos-print-title")).toHaveText(title);
      await expect(root.locator(".kdos-print-scope")).toContainText("已选，共 1 条");
      await expect(root.locator("tbody tr")).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath(`${label}-selected-one.png`) });
    });
  }

  test("Role Members：选 1 条 → 打印已选（1）", async ({ page }) => {
    await login(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "切换到角色" }).click();
    await page.locator(".role-tree-role").first().click();
    const shell = page.locator(".kdos-data-table-shell").last();
    await expect(shell.getByRole("button", { name: /打印筛选结果/ })).toBeVisible({ timeout: 20_000 });
    await shell.locator(".ant-table-tbody tr.ant-table-row").first().locator(".ant-checkbox-input").click();
    const selectedButton = shell.getByRole("button", { name: /打印已选（1）/ });
    await expect(selectedButton).toBeVisible();
    await selectedButton.click();
    const confirm = page.locator(".ant-modal").filter({ hasText: "确认打印" });
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /继续打印/ }).click();
    const root = page.locator(".kdos-print-root");
    await expect(page.getByTestId("kdos-print-preview")).toBeVisible({ timeout: 60_000 });
    await expect(root.locator(".kdos-print-scope")).toContainText("已选，共 1 条");
    await expect(root.locator("tbody tr")).toHaveCount(1);
  });
});
