import { expect, test } from "@playwright/test";

const token = process.env.MPS_TEST_TOKEN ?? "";
const username = process.env.MPS_E2E_USERNAME ?? "";
const password = process.env.MPS_E2E_PASSWORD ?? "";

test.describe("PMC 生产环境登录验收", () => {
  test.skip(!username || !password, "设置 MPS_E2E_USERNAME/MPS_E2E_PASSWORD 后连接已部署环境执行");

  test("登录后旧入口消失且新版主计划可访问", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("密码").fill(password);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator(".portal-module-grid")).toBeVisible();

    await expect(page.getByText("生产主计划", { exact: true })).toHaveCount(0);
    const pmc = page.getByRole("button", { name: "进入PMC中心" });
    await expect(pmc.getByText("月度计划", { exact: true })).toHaveCount(0);
    await expect(pmc.getByText("集团主计划大屏", { exact: true })).toHaveCount(0);
    await expect(pmc.getByText("主计划系统", { exact: true })).toBeVisible();
    await page.screenshot({ path: "../../outputs/pmc-retirement-online-portal.png", fullPage: true });

    await pmc.click();
    await expect(page).toHaveURL(/\/master-plan-system\/mps-erp-orders$/);
    await expect(page.getByRole("heading", { name: "ERP订单明细" })).toBeVisible();
    await page.screenshot({ path: "../../outputs/pmc-retirement-online-mps.png", fullPage: true });

    for (const retiredPath of ["/sales-summary-details", "/on-hand-summary-dashboard", "/monthly/2026/09", "/weekly/rolling-plan", "/work-reports", "/division-order-review"]) {
      await page.goto(retiredPath);
      await expect(page).toHaveURL(/\/$/);
    }

    await page.goto("/master-plan-system/mps-group-plans");
    await expect(page.getByRole("heading", { name: "集团主计划" })).toBeVisible();
  });
});

test.describe("新版主计划线上只读与字段契约", () => {
  test.skip(!token, "设置 MPS_TEST_TOKEN 后连接已部署环境执行");

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((accessToken) => {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("sessionUser", JSON.stringify({ sub: "14142f50-2666-41d4-82ca-09e71cb92804", permissions: ["*"], isSystemAdmin: true }));
    }, token);
  });

  test("ERP订单不暴露客户名称，主计划表默认只读且可退出编辑", async ({ page }) => {
    await page.goto("/master-plan-system/mps-erp-orders");
    await expect(page.getByRole("heading", { name: "ERP订单明细" })).toBeVisible();
    await expect(page.locator(".ant-table-thead").getByText("下单日期", { exact: true }).first()).toBeVisible();
    await expect(page.locator(".ant-table-thead").getByText("客户名称", { exact: true })).toHaveCount(0);

    await page.goto("/master-plan-system/mps-base-plans");
    await expect(page.getByRole("heading", { name: "事业部基础计划表" })).toBeVisible();
    const body = page.locator(".ant-table-tbody");
    const editors = body.locator("input:not([type='checkbox']),textarea");
    await expect(editors).toHaveCount(0);
    await page.getByRole("button", { name: "进入编辑模式" }).click();
    await expect(page.getByRole("button", { name: "退出编辑模式" })).toBeVisible();
    await expect(editors.first()).toBeVisible();
    await page.getByRole("button", { name: "退出编辑模式" }).click();
    await expect(editors).toHaveCount(0);
  });

  test("PMC门户进入新版主计划且旧入口均已退役", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("生产主计划", { exact: true })).toHaveCount(0);
    const pmc = page.getByRole("button", { name: "进入PMC中心" });
    await expect(pmc.getByText("月度计划", { exact: true })).toHaveCount(0);
    await expect(pmc.getByText("集团主计划大屏", { exact: true })).toHaveCount(0);
    await pmc.click();
    await expect(page).toHaveURL(/\/master-plan-system\/mps-erp-orders$/);
    await expect(page.getByRole("heading", { name: "ERP订单明细" })).toBeVisible();

    for (const retiredPath of ["/sales-summary-details", "/on-hand-summary-dashboard", "/monthly/2026/09", "/weekly/rolling-plan", "/work-reports", "/division-order-review"]) {
      await page.goto(retiredPath);
      await expect(page).toHaveURL(/\/$/);
    }

    await page.goto("/master-plan-system/mps-group-plans");
    await expect(page.getByRole("heading", { name: "集团主计划" })).toBeVisible();
  });

  test("基础计划周计划状态可读且按 base_plan_id 精确定位对应周计划", async ({ page }) => {
    await page.goto("/master-plan-system/mps-base-plans");
    await expect(page.getByRole("heading", { name: "事业部基础计划表" })).toBeVisible();
    await expect(page.locator(".ant-table-thead").getByText("周计划状态", { exact: true }).first()).toBeVisible();
    await expect(page.locator(".ant-table-thead").getByText("周计划缺少项", { exact: true }).first()).toBeVisible();

    await page.getByPlaceholder("搜索当前表格").fill("TGG919BDP-1/1");
    const row = page.locator(".ant-table-tbody tr").filter({ hasText: "2026A027192" }).filter({ hasText: "TGG919BDP-1/1" }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText("已进入周计划", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("menuitem", { name: "查看周计划" }).click();
    await expect(page).toHaveURL(/\/master-plan-system\/mps-weekly-plans\?.*basePlanId=[0-9a-f-]{36}/);
    await expect(page.getByText("仅显示该事业部基础计划生成的周计划")).toBeVisible();

    const weeklyRow = page.locator(".ant-table-tbody tr").filter({ hasText: "2026A027192" }).filter({ hasText: "TGG919BDP-1/1" }).first();
    await expect(weeklyRow).toBeVisible();
    await expect(page.locator(".ant-table-tbody tr.ant-table-row")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /新\s*增/ })).toHaveCount(0);

    await page.getByRole("button", { name: "清除定位" }).click();
    await expect(page).toHaveURL(/\/master-plan-system\/mps-weekly-plans$/);
  });

  test("工序字典字段按显示名称筛选可命中数据库 value", async ({ page }) => {
    await page.goto("/master-plan-system/mps-process-reports");
    await expect(page.getByRole("heading", { name: "工序报工表" })).toBeVisible();
    await page.getByRole("tab", { name: "待报工任务" }).click();

    const body = page.locator(".ant-table-tbody");
    await expect(body.locator("tr.ant-table-row").first()).toBeVisible();
    await expect(body).toContainText("折弯");

    await page.locator(".ant-table-thead").getByLabel("工序筛选").first().click();
    const panel = page.locator(".kdos-column-filter-panel");
    await expect(panel).toBeVisible();
    await panel.getByPlaceholder("输入要查找的工序").fill("折弯");
    await panel.getByRole("button", { name: /筛\s*选/ }).click();

    await expect(body.locator("tr.ant-table-row").first()).toBeVisible();
    await expect(body).toContainText("折弯");
    await expect(body).not.toContainText("下料");
    await expect(body).not.toContainText("焊接");
    expect(await body.locator("tr.ant-table-row").count()).toBeGreaterThan(0);
  });

  test("待报工任务按正式字段定义只读展示且不出现独立操作列", async ({ page }) => {
    await page.goto("/master-plan-system/mps-process-reports");
    await page.getByRole("tab", { name: "待报工任务" }).click();

    const headers = page.locator(".ant-table-thead th");
    for (const label of ["订单编号", "品项编码", "品项名称", "工序", "计划数量", "累计报工", "剩余数量", "本次报工数量", "生产日期"]) {
      await expect(headers.filter({ hasText: label }).first()).toBeVisible();
    }
    await expect(headers.filter({ hasText: /^操作$/ })).toHaveCount(0);
    await expect(page.locator(".ant-table-tbody tr.ant-table-row").first()).toBeVisible();

    /* 只读浏览模式：待报工任务没有可填写的报工控件，也没有提交按钮。 */
    const body = page.locator(".ant-table-tbody");
    await expect(body.locator("input:not([type='checkbox'])")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /提交报工/ })).toHaveCount(0);

    /* 进入编辑模式后才出现填报控件与提交入口（工具栏，不占用独立操作列）。 */
    await page.getByRole("button", { name: "进入编辑模式" }).click();
    await expect(page.getByRole("button", { name: /提交报工/ })).toBeVisible();
    await expect(body.getByPlaceholder("本次报工").first()).toBeVisible();
    await page.getByRole("button", { name: "退出编辑模式" }).click();
    await expect(page.getByRole("button", { name: /提交报工/ })).toHaveCount(0);
  });

  test("类型化高级筛选按字段类型提供条件并只在点击筛选后刷新", async ({ page }) => {
    await page.goto("/master-plan-system/mps-process-reports");
    await page.getByRole("tab", { name: "待报工任务" }).click();
    const body = page.locator(".ant-table-tbody");
    await expect(body.locator("tr.ant-table-row").first()).toBeVisible();
    const baseline = await body.locator("tr.ant-table-row").count();

    await page.getByRole("button", { name: /高级筛选|条条件/ }).click();
    const panel = page.getByTestId("advanced-filter-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("筛选出符合以下")).toBeVisible();

    await panel.getByRole("button", { name: /添加过滤条件/ }).click();
    await panel.getByText("选择字段").first().click();
    await page.getByTitle("工序").last().click();
    /* 工序为字典字段：条件是“等于”，值是正式下拉候选（来自 canonical registry）。 */
    await panel.getByText("等于").first().click();
    await page.getByTitle("毛坯").last().click();
    /* 未点击“筛选”前不得刷新正式列表。 */
    expect(await body.locator("tr.ant-table-row").count()).toBe(baseline);

    await panel.getByRole("button", { name: /筛\s*选/ }).click();
    await expect(body).toContainText("毛坯");
    await expect(body).not.toContainText("折弯");
    await expect(page.getByRole("button", { name: /1 条条件/ })).toBeVisible();

    /* 清空恢复全部待报工任务。 */
    await page.getByRole("button", { name: /条条件/ }).click();
    await panel.getByRole("button", { name: /清\s*空/ }).click();
    await expect(body).toContainText("折弯");
  });
});
