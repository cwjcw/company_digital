import { expect, test, type Page } from "@playwright/test";

const user = { sub: "u-admin", username: "admin", displayName: "测试管理员", roles: ["系统管理员"], isSystemAdmin: true, moduleAdminCodes: [], permissions: ["*"], divisions: "*", mustChangePassword: false };

async function mockApplication(page: Page) {
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ accessToken: "test-token", refreshToken: "refresh", user }) }));
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/api/v1/master-plan-system/resources/*/meta", async (route) => {
    const resource = new URL(route.request().url()).pathname.split("/").at(-2);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ resource, fields: [{ key: "orderNumber", label: "订单编号", type: "text", editable: false, required: false }], createFields: [], actions: { create: false, update: false, delete: false, import: false, export: false, batchUpdate: false } }) });
  });
  await page.route("**/api/v1/master-plan-system/resources/*?*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], total: 0, page: 1, pageSize: 50 }) }));
  await page.route("**/api/v1/directory/users", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("test");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator(".portal-module-grid")).toBeVisible();
}

test("PMC portal and routes expose only the current master-plan UI", async ({ page }) => {
  await mockApplication(page);
  await login(page);

  await expect(page.getByText("生产主计划", { exact: true })).toHaveCount(0);
  const pmc = page.getByRole("button", { name: "进入PMC中心" });
  await expect(pmc.getByText("月度计划", { exact: true })).toHaveCount(0);
  await expect(pmc.getByText("集团主计划大屏", { exact: true })).toHaveCount(0);
  await expect(pmc.getByText("主计划系统", { exact: true })).toBeVisible();

  await pmc.click();
  await expect(page).toHaveURL(/\/master-plan-system\/mps-erp-orders$/);
  await expect(page.getByRole("heading", { name: "ERP订单明细" })).toBeVisible();

  await page.goto("/sales-summary-details");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/on-hand-summary-dashboard");
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/master-plan-system/mps-group-plans");
  await expect(page.getByRole("heading", { name: "集团主计划" })).toBeVisible();
});
