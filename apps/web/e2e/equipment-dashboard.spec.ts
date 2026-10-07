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

test.describe("设备大屏未填报与六表导出线上验收", () => {
  test.skip(!username || !password, "需要现有 EQUIPMENT_E2E_USERNAME/EQUIPMENT_E2E_PASSWORD；不创建测试账号或修改生产权限");
  test("未填报数字等于明细数量，六表按当前日期下载xlsx", async ({ page }) => {
    await page.goto("/"); await page.getByLabel("用户名").fill(username); await page.getByLabel("密码").fill(password); await page.locator('button[type="submit"]').click(); await expect(page.locator(".portal-module-grid")).toBeVisible();
    const response = page.waitForResponse(r => r.url().includes("/api/v1/equipment/dashboard?") && r.ok());
    await page.goto("/equipment-dashboard"); const data = await (await response).json();
    expect(data.unreportedEquipmentRows.length).toBe(data.operationsMonitoring.yesterday.unfilledEquipmentCount);
    await expect(page.getByText("未填报设备明细", { exact: true })).toBeVisible();
    for (const [title, prefix] of [["未填报设备明细", "equipment_unreported"], ["事业部填报与稼动情况", "equipment_division_reporting"], ["部门填报与稼动情况", "equipment_department_reporting"], ["按事业部设备运行分析", "equipment_division_operation"], ["按车间/使用部门设备运行分析", "equipment_department_operation"], ["设备稼动率明细", "equipment_utilization_detail"]]) {
      const heading = page.locator(".ant-card-head-title").filter({ hasText: title! });
      const button = heading.locator("..").locator("..").locator("..").getByRole("button", { name: "导出 Excel" });
      if (await button.isDisabled()) continue; // Empty views intentionally do not create workbooks.
      const download = page.waitForEvent("download"); await button.click(); const file = await download;
      expect(file.suggestedFilename()).toBe(`${prefix}_${data.windowEnd}.xlsx`); expect(await file.failure()).toBeNull();
    }
  });
});
