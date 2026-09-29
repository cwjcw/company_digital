import { expect, test, type Page } from "@playwright/test";

const user = { sub: "scroll-diag-admin", username: "admin", displayName: "滚动诊断管理员", roles: ["系统管理员"], isSystemAdmin: true, moduleAdminCodes: [], permissions: ["*"], divisions: "*", mustChangePassword: false };

async function mockApplication(page: Page) {
  const rows = Array.from({ length: 80 }, (_, index) => ({
    id: `scroll-${index}`,
    divisionId: "division-1",
    divisionName: "事业一部",
    usageDepartmentId: "department-1",
    usageDepartmentName: "生产部门",
    equipmentCode: `EQ-${String(index + 1).padStart(3, "0")}`,
    equipmentName: `滚动诊断设备 ${index + 1}`,
    purchaseDate: "2026-01-01",
    plannedStartupMinutes: 480,
    monitored: true,
    responsibleUserIds: [],
    responsibleUsers: [],
    version: 1
  }));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
    let body: unknown = {};
    if (path === "/auth/login") body = { accessToken: "scroll-test-token", refreshToken: "scroll-test-refresh", user };
    else if (path === "/auth/me") body = user;
    else if (path === "/equipment/assets") body = { rows, total: rows.length, page: 1, pageSize: 50 };
    else if (path === "/equipment/options") body = { equipment: [], users: [], organizations: [] };
    else if (path === "/table-filters/resources") body = [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("test");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator(".portal-module-grid")).toBeVisible();
}

test("标准表页面纵向滚动时字段表头真实 sticky，且不制造第二个纵向滚动条", async ({ page }) => {
  await mockApplication(page);
  await login(page);
  await page.goto("/equipment-register");
  await expect(page.getByRole("heading", { name: "设备总台账" })).toBeVisible();
  const holder = page.locator(".ant-table-sticky-holder");
  await expect(holder).toBeVisible();

  const before = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".content")!;
    const body = document.querySelector<HTMLElement>(".ant-table-body")!;
    return {
      contentOverflowY: getComputedStyle(content).overflowY,
      contentScrollHeight: content.scrollHeight,
      contentClientHeight: content.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyOverflowX: getComputedStyle(body).overflowX,
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      holderTop: document.querySelector<HTMLElement>(".ant-table-sticky-holder")!.getBoundingClientRect().top
    };
  });
  expect(before.contentOverflowY).toBe("visible");
  expect(before.contentScrollHeight).toBe(before.contentClientHeight);
  expect(before.documentScrollHeight).toBeGreaterThan(before.documentClientHeight);
  expect(before.bodyOverflowY).toBe("hidden");
  expect(before.bodyOverflowX).toBe("auto");
  expect(before.bodyScrollWidth).toBeGreaterThan(before.bodyClientWidth);

  await page.evaluate(() => window.scrollTo(0, 500));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const after = await holder.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.y).toBeGreaterThanOrEqual(-1);
  expect(after!.y).toBeLessThanOrEqual(1);
});
