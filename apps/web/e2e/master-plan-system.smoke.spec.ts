import { expect, test } from "@playwright/test";

const token = process.env.MPS_TEST_TOKEN ?? "";

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
});
