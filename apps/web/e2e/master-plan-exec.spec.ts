import { expect, test, type Page } from "@playwright/test";

/**
 * KN-MPS-EXEC-001 浏览器 UAT：月/周计划的工序名称、颜色、状态、生产进度与唯一异常列。
 */
const username = process.env.KNM_E2E_USERNAME ?? "__knm_uat";
const password = process.env.KNM_E2E_PASSWORD ?? "";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("accessToken")))).toBe(true);
}

test.describe("KN-MPS-EXEC-001 工序执行可视化", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!password, "缺少 KNM_E2E_PASSWORD");

  for (const [label, resource, title] of [["月计划", "mps-monthly-plans", "事业部月度计划"], ["周计划", "mps-weekly-plans", "事业部周计划"]] as const) {
    test(`${label}：10 个工序名称、组内 周期/交期/状态/生产进度、唯一异常列`, async ({ page }, testInfo) => {
      await login(page);
      await page.goto(`/master-plan-system/${resource}`);
      await expect(page.getByRole("heading", { name: title }).first()).toBeVisible({ timeout: 25_000 });
      const headers = await page.locator(".ant-table-thead th").allInnerTexts();
      const names = ["下料", "机加", "折弯", "点焊", "焊接", "木作", "研磨", "毛坯", "表面处理", "包装"];
      /* 工序一级名称全部可见且有固定顺序（毛坯在研磨与表面处理之间）。 */
      for (const name of names) expect(headers, `${label} 缺少工序 ${name}`).toContain(name);
      expect(headers.indexOf("研磨")).toBeLessThan(headers.indexOf("毛坯"));
      expect(headers.indexOf("毛坯")).toBeLessThan(headers.indexOf("表面处理"));
      /* 每个工序组内字段：周期 / 交期 / 状态 / 生产进度（不再有每工序异常列）。 */
      expect(headers).toContain("所需周期");
      expect(headers).toContain("交期");
      expect(headers).toContain("状态");
      expect(headers).toContain("生产进度");
      /* 整表只有 1 个「异常」列。 */
      expect(headers.filter((header) => header === "异常")).toHaveLength(1);
      /* 工序颜色分层：一级表头/二级表头/数据单元格都有工序语义 class，且相邻工序不同色。 */
      const headClasses = await page.locator(".ant-table-thead th.kdos-process-head").evaluateAll((cells) => cells.map((cell) => cell.className));
      expect(headClasses.length).toBeGreaterThanOrEqual(10);
      expect(new Set(headClasses).size).toBeGreaterThanOrEqual(10);
      await page.screenshot({ path: testInfo.outputPath(`${resource}.png`) });
    });
  }

  test("生产进度：<100% 不绿、>=100% 只绿进度单元格，Hover 显示需求/累计报工/报次数/进度", async ({ page }) => {
    await login(page);
    await page.goto("/master-plan-system/mps-weekly-plans");
    await expect(page.getByRole("heading", { name: "事业部周计划" }).first()).toBeVisible({ timeout: 25_000 });
    /* 通过筛选定位到 4 次报工、进度 207.1% 的那一行。 */
    await page.getByRole("button", { name: /高级筛选/ }).first().click();
    const panel = page.locator(".ant-popover").filter({ hasText: "添加过滤条件" }).last();
    await panel.getByRole("button", { name: /添加过滤条件/ }).click();
    await panel.locator(".ant-select-selector").nth(1).click();
    await page.getByTitle("订单编号").last().click();
    await panel.getByPlaceholder("输入要匹配的内容").fill("2026A027192");
    await panel.getByRole("button", { name: /筛\s*选/ }).click();
    await expect(page.locator(".kdos-data-table-shell .ant-table-tbody tr.ant-table-row").first()).toBeVisible({ timeout: 25_000 });
    const greenCells = page.locator(".kdos-progress-cell.kdos-progress-satisfied");
    await expect(greenCells.first()).toBeVisible({ timeout: 20_000 });
    await expect(greenCells.first()).toHaveText("207.1%");
    /* Hover 详情：需求数量 / 累计报工 / 报工次数 / 生产进度 */
    await greenCells.first().hover();
    const tooltip = page.locator(".ant-tooltip-inner").last();
    await expect(tooltip).toContainText("需求数量：70");
    await expect(tooltip).toContainText("累计报工：145.0000");
    await expect(tooltip).toContainText("报工次数：4");
    await expect(tooltip).toContainText("生产进度：207.1%");
  });
});
