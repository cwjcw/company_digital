import { expect, test, type Page } from "@playwright/test";

const enabled = process.env.MPS_E2E_REAL === "1";
const username = process.env.MPS_E2E_USERNAME ?? "";
const password = process.env.MPS_E2E_PASSWORD ?? "";
const divisionOne = process.env.MPS_DIVISION_ONE_ID ?? "";
const divisionTwo = process.env.MPS_DIVISION_TWO_ID ?? "";
const prefix = "TEST_20260911_";
const runId = process.env.MPS_RUN_ID ?? String(Date.now());

async function selectOrganization(dialog: ReturnType<Page["getByRole"]>, fieldLabel: string, optionText: string) {
  const item = dialog.locator(".ant-form-item", { hasText: fieldLabel });
  await item.locator(".ant-select-selector").click();
  await dialog.page().getByRole("option", { name: new RegExp(optionText) }).last().click();
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("accessToken")))).toBe(true);
}

async function openResource(page: Page, resource: string, title: string) {
  await page.goto(`/master-plan-system/${resource}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

async function createCustomerMapping(page: Page, code: string, divisionName: string) {
  await page.getByRole("button", { name: /新\s*增/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".ant-form-item", { hasText: "客户编码" }).locator("textarea:visible").fill(code);
  await selectOrganization(dialog, "主责事业部", divisionName);
  await dialog.getByRole("button", { name: /确\s*定/ }).click();
}

test.describe("主计划系统真实业务页面", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!enabled, "设置 MPS_E2E_REAL=1 后连接指定环境执行");
  test.beforeEach(async ({ page }) => {
    test.skip(!username || !password || !divisionOne || !divisionTwo, "缺少真实环境测试账号或事业部稳定ID");
    await login(page);
  });

  test("PMC通过页面建立客户事业部映射并阻止重复客户", async ({ page }) => {
    await openResource(page, "mps-customer-divisions", "客户事业部映射");
    const customerA = `${prefix}UI_${runId}_C001`;
    const customerB = `${prefix}UI_${runId}_C002`;
    await createCustomerMapping(page, customerA, "事业一部");
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
    await page.getByPlaceholder("搜索当前表格").fill(customerA);
    await expect(page.getByText(customerA, { exact: true })).toBeVisible();

    await createCustomerMapping(page, customerA, "事业二部");
    await expect(page.getByText(/重复|已存在|唯一/)).toBeVisible();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: /取\s*消/ }).click();

    await createCustomerMapping(page, customerB, "事业二部");
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  });

  test("计划评审通过页面把同一订单不同品项分配给不同事业部", async ({ page }) => {
    await openResource(page, "mps-order-allocations", "订单分配表");
    await page.getByPlaceholder("搜索当前表格").fill(`${prefix}SO001`);
    await page.getByRole("button", { name: "进入编辑模式" }).click();

    await page.locator(".ant-table-tbody button").nth(0).click();
    await selectOrganization(page.getByRole("dialog"), "承接事业部", "事业一部");
    const firstResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("mps-order-allocations"));
    await page.getByRole("dialog").getByRole("button", { name: /确\s*定/ }).click();
    expect((await firstResponse).ok()).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });

    await page.locator(".ant-table-tbody button").nth(1).click();
    await selectOrganization(page.getByRole("dialog"), "承接事业部", "事业二部");
    const secondResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("mps-order-allocations"));
    await page.getByRole("dialog").getByRole("button", { name: /确\s*定/ }).click();
    expect((await secondResponse).ok()).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  });

  test("18张主计划业务表均可从真实前端打开", async ({ page }) => {
    const resources = [
      ["mps-erp-orders", "ERP订单明细"], ["mps-customer-divisions", "客户事业部映射"], ["mps-order-allocations", "订单分配表"],
      ["mps-process-cycles", "工序周期表"], ["mps-group-plans", "集团主计划"], ["mps-monthly-plans", "事业部月度计划"],
      ["mps-shipping-plans", "出货计划表"], ["mps-base-plans", "事业部基础计划表"], ["mps-weekly-plans", "事业部周计划"],
      ["mps-weekly-process-plans", "周计划工序明细"], ["mps-technical-reports", "技术报工表"], ["mps-material-reports", "主材报工表"],
      ["mps-outsourcing-reports", "外协报工表"], ["mps-process-reports", "工序报工表"], ["mps-sync-configs", "同步配置"],
      ["mps-sync-logs", "同步日志"], ["mps-data-exceptions", "数据异常"], ["mps-system-settings", "系统参数"]
    ] as const;
    for (const [resource, title] of resources) await openResource(page, resource, title);
  });

  test("PMC通过页面新增出货计划并补齐基础计划后下推周计划", async ({ page }) => {
    const order = `${prefix}UI_SHIP_${runId}`;
    const item = `${prefix}UI_ITEM_MISSING_${runId}`;
    await openResource(page, "mps-shipping-plans", "出货计划表");
    await page.getByRole("button", { name: /新\s*增/ }).click();
    let dialog = page.getByRole("dialog");
    const textarea = (label: string) => dialog.locator(".ant-form-item", { hasText: label }).locator("textarea:visible");
    await textarea("客户编码").fill(`${prefix}C001`);
    await textarea("订单编号").fill(order);
    await textarea("品项编码").fill(item);
    await textarea("品项名称").fill("测试缺周期页面品项");
    await dialog.locator(".ant-form-item", { hasText: "交期编码" }).locator("input").fill("1");
    await dialog.locator(".ant-form-item", { hasText: "下单日期" }).locator("input").fill("2026-09-11");
    await dialog.locator(".ant-form-item", { hasText: "最迟客户交期" }).locator("input").fill("2026-10-20");
    await dialog.locator(".ant-form-item", { hasText: "计划数量" }).locator("input").fill("120");
    await selectOrganization(dialog, "承接事业部", "事业一部");
    await dialog.locator(".ant-form-item", { hasText: "新旧款" }).locator(".ant-select-selector").click();
    await page.locator(".ant-select-dropdown:visible").getByTitle("新", { exact: true }).click();
    const created = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/mps-shipping-plans"));
    await dialog.getByRole("button", { name: /确\s*定/ }).click();
    expect((await created).ok()).toBe(true);
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });

    await openResource(page, "mps-base-plans", "事业部基础计划表");
    await page.getByPlaceholder("搜索当前表格").fill(order);
    const targetRow = page.locator(".ant-table-tbody tr", { hasText: order });
    await expect(targetRow).toBeVisible();
    await page.getByRole("button", { name: "进入编辑模式" }).click();
    await targetRow.getByRole("button", { name: /编\s*辑/ }).click();
    dialog = page.getByRole("dialog");
    await dialog.locator(".ant-form-item", { hasText: "最迟评审交期" }).locator("input").fill("2026-10-20");
    await dialog.locator(".ant-form-item", { hasText: "产品属性" }).locator(".ant-select-selector").click();
    await page.locator(".ant-select-dropdown:visible").getByTitle("五金+木作", { exact: true }).click();
    await dialog.locator(".ant-form-item", { hasText: "表面性质" }).locator(".ant-select-selector").click();
    await page.locator(".ant-select-dropdown:visible").getByTitle("烤漆", { exact: true }).click();
    await dialog.locator(".ant-form-item", { hasText: "生产方式" }).locator(".ant-select-selector").click();
    await page.locator(".ant-select-dropdown:visible").getByTitle("自制", { exact: true }).click();
    const updated = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("mps-base-plans"));
    await dialog.getByRole("button", { name: /确\s*定/ }).click();
    expect((await updated).ok()).toBe(true);
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });

    await openResource(page, "mps-weekly-plans", "事业部周计划");
    await page.getByPlaceholder("搜索当前表格").fill(order);
    await expect(page.locator(".ant-table-tbody tr", { hasText: order })).toBeVisible();
  });
});
