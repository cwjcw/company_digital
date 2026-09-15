import { expect, test } from "@playwright/test";

const username = process.env.EQUIPMENT_E2E_USERNAME ?? "";
const password = process.env.EQUIPMENT_E2E_PASSWORD ?? "";

function shanghaiYesterday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return new Date(Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day")) - 1)).toISOString().slice(0, 10);
}

test.describe("集团设备大屏线上日期筛选", () => {
  test.skip(!username || !password, "设置 EQUIPMENT_E2E_USERNAME/EQUIPMENT_E2E_PASSWORD 后连接已部署环境执行");

  test("默认按上海昨天查询", async ({ page }) => {
    const expected = shanghaiYesterday();
    await page.goto("/");
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("密码").fill(password);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator(".portal-module-grid")).toBeVisible();

    await page.goto("/equipment-dashboard");
    await expect(page.getByRole("heading", { name: "设备情况统计" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => url.includes("/api/v1/equipment/dashboard?")) ?? ""))
      .toContain(`periodType=day&period=${expected}`);
    await expect(page.getByText("有数据设备", { exact: true })).toBeVisible();
  });
});
