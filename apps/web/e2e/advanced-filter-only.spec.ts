import { expect, test, type Page } from "@playwright/test";

/**
 * KN-FILTER-002 浏览器 UAT：标准表格只能看到一套筛选入口——“高级筛选”。
 * 旧「筛选」按钮和 Ant 列头漏斗消失；统一列菜单提供排序与列头筛选。
 */
const username = process.env.KNF2_E2E_USERNAME ?? "__knf2_admin";
const password = process.env.KNF2_E2E_PASSWORD ?? "";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("accessToken")))).toBe(true);
}

const PAGES: Array<[string, string, string]> = [
  ["Master Plan", "/master-plan-system/mps-weekly-plans", "事业部周计划"],
  ["Equipment", "/equipment-register", "设备总台账"],
  ["Data Center", "/data-center/sales-orders", "订单表"],
  ["Marketing", "/marketing/order-schedule", "订单排期"],
  ["Users", "/users", "用户与角色"]
];

test.describe("KN-FILTER-002 只有一套高级筛选入口", () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!password, "缺少 KNF2_E2E_PASSWORD");

  for (const [label, path, title] of PAGES) {
    test(`${label}：保留高级筛选，列头使用统一菜单`, async ({ page }, testInfo) => {
      await login(page);
      await page.goto(path);
      await expect(page.getByRole("heading", { name: title }).first()).toBeVisible({ timeout: 20_000 });
      const shell = page.locator(".kdos-data-table-shell").first();
      const toolbar = shell.locator(".kdos-data-table-toolbar").first();
      /* 只有一个高级筛选入口。 */
      await expect(toolbar.getByRole("button", { name: /高级筛选/ })).toHaveCount(1);
      await expect(toolbar.getByRole("button", { name: /^筛选/ })).toHaveCount(0);
      /* 旧「按字段筛选」抽屉不存在。 */
      await expect(page.getByText("按字段筛选")).toHaveCount(0);
      /* 列头不再提供 Ant 独立漏斗或独立排序按钮。 */
      await expect(page.locator(".ant-table-filter-trigger")).toHaveCount(0);
      await expect(page.locator(".ant-table-column-has-sorters")).toHaveCount(0);
      /* 快速搜索保留。 */
      await expect(shell.getByPlaceholder(/搜索/)).toHaveCount(1);
      await expect(shell.getByRole("button", { name: /列菜单/ }).first()).toBeAttached();
      await page.screenshot({ path: testInfo.outputPath(`${label}.png`) });
    });
  }

  test("Role Members：角色成员视图同样只有高级筛选", async ({ page }, testInfo) => {
    await login(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "切换到角色" }).click();
    await page.locator(".role-tree-role").first().click();
    const shell = page.locator(".kdos-data-table-shell").last();
    await expect(shell.getByRole("button", { name: /高级筛选/ })).toHaveCount(1);
    await expect(page.locator(".ant-table-filter-trigger")).toHaveCount(0);
    await expect(shell.getByRole("button", { name: /列菜单/ }).first()).toBeAttached();
    await page.screenshot({ path: testInfo.outputPath("RoleMembers.png") });
  });
});
