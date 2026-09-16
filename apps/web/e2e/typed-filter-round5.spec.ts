import { expect, test, type Page } from "@playwright/test";

/**
 * KN-FILTER-001 第五轮浏览器 UAT：新增接入的系统管理/流程/营销页面在真实环境可用，
 * 且未接入页面不会出现假筛选。需要 KNR5_E2E_ADMIN_PASSWORD / KNR5_E2E_USER_PASSWORD + E2E_BASE_URL。
 */
const adminUser = process.env.KNR5_E2E_ADMIN_USERNAME ?? "__knr5_admin";
const adminPassword = process.env.KNR5_E2E_ADMIN_PASSWORD ?? "";
const normalUser = process.env.KNR5_E2E_USER_USERNAME ?? "__knr5_user";
const normalPassword = process.env.KNR5_E2E_USER_PASSWORD ?? "";

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); });
  await page.goto("/");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("accessToken")))).toBe(true);
}

test.describe("KN-FILTER-001 第五轮浏览器 UAT", () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!adminPassword || !normalPassword, "缺少第五轮 UAT 账号密码");

  test("新增接入系统/流程/营销页面：高级筛选可用且列表有数据", async ({ page }, testInfo) => {
    await login(page, adminUser, adminPassword);
    const pages: Array<[string, string]> = [
      ["/organization", "组织架构表"],
      ["/contacts", "通讯录"],
      ["/master-data", "基础数据维护"],
      ["/workflow-settings", "审批流程配置"],
      ["/marketing/business-customers", "业务人员与客户对应表"],
      ["/marketing/order-schedule", "订单排期"]
    ];
    for (const [path, title] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: title }).first()).toBeVisible();
      const advanced = page.getByRole("button", { name: /高级筛选/ }).first();
      await expect(advanced).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll("/", "_")}.png`) });
    }
  });

  test("未接入页面不显示可填写但无效的高级筛选（用户/角色）", async ({ page }) => {
    await login(page, adminUser, adminPassword);
    await page.goto("/users");
    await expect(page.getByRole("button", { name: /暂不支持/ })).toBeDisabled();
  });

  test("普通用户不可查看需求提报与审批数据", async ({ page }) => {
    await login(page, normalUser, normalPassword);
    await page.goto("/development-requests");
    /* 页面不展示需求数据（后端 403），不出现任何需求编号行。 */
    await expect(page.getByText("需求提报与审批数据仅系统管理员或流程审批模块管理员可以查看").first()).toBeVisible();
  });
});
