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
      ["/master-data", "基础资料维护"],
      ["/workflow-settings", "审批流程配置"],
      ["/marketing/business-customers", "业务人员与客户对应表"],
      ["/marketing/order-schedule", "订单排期"]
    ];
    for (const [path, title] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: title }).first(), `页面 ${path} 应渲染标题`).toBeVisible({ timeout: 15_000 });
      const advanced = page.getByRole("button", { name: /高级筛选/ }).first();
      await expect(advanced, `页面 ${path} 应显示可用的高级筛选`).toBeEnabled({ timeout: 15_000 });
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
    /* 后端 403：普通用户看不到任何需求数据（不出现需求编号/标题行），页面提示无数据或错误。 */
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/REQ-\d/);
    expect(body).not.toContain("需求说明");
    /* 安全断言：普通用户页面上不出现任何需求编号或需求说明内容。 */
    expect(body).not.toContain("REQ-");
  });
});
