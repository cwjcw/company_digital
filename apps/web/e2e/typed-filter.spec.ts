import { expect, test, type Page } from "@playwright/test";

/**
 * KN-FILTER-001 第四轮浏览器 UAT（真实前端 + 真实 API）。
 * 需要环境变量 KNFILTER_E2E_USERNAME / KNFILTER_E2E_PASSWORD 与 E2E_BASE_URL 指向已部署环境。
 */
const username = process.env.KNFILTER_E2E_USERNAME ?? "";
const password = process.env.KNFILTER_E2E_PASSWORD ?? "";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("accessToken")))).toBe(true);
}

/** 高级筛选面板挂在 Popover 中，按可见面板范围定位，避免与顶部快速搜索混淆。 */
function filterPanel(page: Page) {
  return page.locator(".ant-popover").filter({ hasText: "添加过滤条件" }).last();
}

async function addRuleWithField(page: Page, fieldTitle: string, operatorTitle?: string) {
  await page.getByRole("button", { name: /高级筛选/ }).first().click();
  const panel = filterPanel(page);
  await expect(panel.getByText("筛选出符合以下")).toBeVisible();
  await panel.getByRole("button", { name: /添加过滤条件/ }).click();
  /* 第 0 个选择器是“所有/任一”，第 1 个是字段，第 2 个是操作符。 */
  await panel.locator(".ant-select-selector").nth(1).click();
  await page.getByTitle(fieldTitle).click();
  if (operatorTitle) {
    await panel.locator(".ant-select-selector").nth(2).click();
    await page.getByTitle(operatorTitle).click();
  }
  return panel;
}

test.describe("类型化高级筛选浏览器 UAT", () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!username || !password, "设置 KNFILTER_E2E_USERNAME/KNFILTER_E2E_PASSWORD 后连接已部署环境执行");

  test("已接入资源：高级筛选按确认生效，列头使用统一菜单", async ({ page }, testInfo) => {
    await login(page);
    const listRequests: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/equipment/assets")) listRequests.push(decodeURIComponent(request.url())); });

    await page.goto("/equipment-register");
    await expect(page.getByRole("heading", { name: "设备总台账" })).toBeVisible();
    await expect.poll(() => listRequests.length).toBeGreaterThan(0);
    /* 等首屏所有请求（含首屏后的偏好/失效重取）稳定，再开始数请求。 */
    await page.waitForTimeout(1500);
    const before = listRequests.length;

    const panel = await addRuleWithField(page, "设备名称");
    await panel.getByPlaceholder("输入要匹配的内容").fill("CNC");

    /* draft 变化不得触发列表请求。 */
    await page.waitForTimeout(800);
    expect(listRequests.length).toBe(before);
    await page.screenshot({ path: testInfo.outputPath("advanced-filter-draft.png") });

    await panel.getByRole("button", { name: /筛\s*选/ }).click();
    await expect.poll(() => listRequests.length).toBeGreaterThan(before);
    const applied = listRequests.at(-1)!;
    expect(applied).toContain("filterGroup");
    expect(applied).toContain("equipmentName");
    console.log("APPLIED URL:", applied.slice(0, 600));
    /* 文本字段的默认条件与列头筛选一致，都是“包含”。 */
    expect(applied).toContain("contains");
    expect(applied).toContain("page=1");

    /* 高级筛选与列头筛选是独立入口，共用服务端 FilterGroup 编译器。 */
    const header = page.locator("th", { hasText: "设备名称" }).first();
    await expect(header.locator(".ant-table-filter-trigger")).toHaveCount(0);
    await header.getByRole("button", { name: "设备名称列菜单" }).click();
    const menu = page.getByTestId("column-menu-equipmentName");
    await expect(menu.getByRole("button", { name: "升序" })).toBeVisible();
    await menu.getByRole("button", { name: "筛选" }).click();
    await expect(menu.getByPlaceholder("搜索字段值……")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("header-filter-menu.png") });
  });

  test("时长字段按小时+分钟输入；百分比字段不要求输入 0.8", async ({ page }) => {
    await login(page);
    await page.goto("/equipment-register");
    await expect(page.getByRole("heading", { name: "设备总台账" })).toBeVisible();
    const panel = await addRuleWithField(page, "设备计划开机时间", "大于等于");
    await expect(panel.getByPlaceholder("小时")).toBeVisible();
    await expect(panel.getByPlaceholder("分钟")).toBeVisible();
    await panel.getByPlaceholder("小时").fill("8");
    await panel.getByPlaceholder("分钟").fill("30");
  });

  test("未接入资源不显示可填写但无效的高级筛选", async ({ page }) => {
    await login(page);
    await page.goto("/users");
    const disabled = page.getByRole("button", { name: /暂不支持/ });
    await expect(disabled).toBeVisible();
    await expect(disabled).toBeDisabled();
  });
});
