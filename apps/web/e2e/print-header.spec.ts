import { expect, test, type Page } from "@playwright/test";

/**
 * KN-PRINT-001 打印页眉缺陷修复 UAT（真实 Chrome）：
 * 打印时间按 Asia/Shanghai 显示、打印人显示真实姓名（不显示 UUID）、不再出现筛选描述、保留打印范围。
 */
const username = process.env.KNP3_E2E_USERNAME ?? "__knp3_uat";
const password = process.env.KNP3_E2E_PASSWORD ?? "";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("accessToken")))).toBe(true);
}

test.describe("KN-PRINT-001 打印页眉元信息", () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!password, "缺少 KNP3_E2E_PASSWORD");

  test("设备状态填报：打印时间=中国标准时间、打印人=真实姓名、无筛选描述、保留打印范围", async ({ page }, testInfo) => {
    await login(page);
    await page.goto("/equipment-status-report");
    await expect(page.getByRole("heading", { name: "设备状态填报" })).toBeVisible({ timeout: 20_000 });
    /* 先用快速搜索制造“有搜索/筛选”的场景，确认页眉不再出现筛选描述。 */
    const search = page.locator(".kdos-data-table-shell").first().getByPlaceholder(/搜索/).first();
    await search.fill("KN-0201");
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: /打印筛选结果/ }).click();
    const confirm = page.locator(".ant-modal").filter({ hasText: "确认打印" });
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /继续打印/ }).click();
    const root = page.locator(".kdos-print-root");
    await expect(page.getByTestId("kdos-print-preview")).toBeVisible({ timeout: 60_000 });

    const header = await root.locator(".kdos-print-header").innerText();
    console.log("PRINT HEADER:\n" + header);
    /* 1) 时间：中国标准时间（Asia/Shanghai），与当前时刻相差不超过 2 分钟 */
    const match = header.match(/打印时间：(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    expect(match, "页眉必须包含 打印时间：YYYY-MM-DD HH:mm:ss").toBeTruthy();
    const printedAt = new Date(match![1]!.replace(" ", "T") + "+08:00").getTime();
    expect(Math.abs(Date.now() - printedAt)).toBeLessThan(120_000);
    /* 2) 打印人：真实姓名，不能是 UUID */
    const person = header.match(/打印人：(.+)/)?.[1]?.trim();
    expect(person).toBe("崔玮杰打印验收");
    expect(header).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    /* 3) 不出现筛选描述；4) 保留打印范围 */
    expect(header).not.toContain("已应用搜索和筛选条件");
    expect(header).not.toContain("已筛选");
    expect(header).toContain("打印范围：");
    expect(header).not.toContain("equipment-status-report");
    /* 元信息排版：打印时间与打印人之间必须有可见间距（不得粘在一起）。 */
    const metaSpans = root.locator(".kdos-print-meta > span");
    const first = await metaSpans.nth(0).boundingBox();
    const second = await metaSpans.nth(1).boundingBox();
    expect(first && second).toBeTruthy();
    expect(second!.x - (first!.x + first!.width)).toBeGreaterThanOrEqual(8);
    await page.screenshot({ path: testInfo.outputPath("print-header.png") });
  });

  test("回归：选中 1 条仍只打印 1 条，且页眉元信息一致", async ({ page }) => {
    await login(page);
    await page.goto("/equipment-status-report");
    await expect(page.getByRole("heading", { name: "设备状态填报" })).toBeVisible({ timeout: 20_000 });
    const shell = page.locator(".kdos-data-table-shell").first();
    await shell.locator(".ant-table-tbody tr.ant-table-row").first().locator(".ant-checkbox-input").click();
    const selectedButton = shell.getByRole("button", { name: /打印已选（1）/ });
    await expect(selectedButton).toBeVisible();
    await selectedButton.click();
    const confirm = page.locator(".ant-modal").filter({ hasText: "确认打印" });
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /继续打印/ }).click();
    const root = page.locator(".kdos-print-root");
    await expect(page.getByTestId("kdos-print-preview")).toBeVisible({ timeout: 60_000 });
    await expect(root.locator(".kdos-print-scope")).toContainText("已选，共 1 条");
    await expect(root.locator("tbody tr")).toHaveCount(1);
    const header = await root.locator(".kdos-print-header").innerText();
    expect(header).toContain("打印人：崔玮杰打印验收");
    expect(header).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });
});
