import { expect, test, type Page } from "@playwright/test";

/**
 * KN-EQUIP-001 真实浏览器 UAT：事业部数据范围用户在「设备状态填报」的新增行为。
 * 要求环境变量 KNE_E2E_USERNAME / KNE_E2E_PASSWORD（该用户的数据范围为事业部=事业一部，且有 create 权限）。
 */
const username = process.env.KNE_E2E_USERNAME ?? "__kne_test";
const password = process.env.KNE_E2E_PASSWORD ?? "";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("accessToken")))).toBe(true);
}

test.describe("KN-EQUIP-001 设备状态填报新增", () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!password, "缺少 KNE_E2E_PASSWORD");

  test("事业部用户：候选只有本事业部设备，可成功新增并关闭弹窗", async ({ page }, testInfo) => {
    await login(page);
    await page.goto("/equipment-status-report");
    await expect(page.getByRole("heading", { name: "设备状态填报" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /填报设备状态/ }).click();
    const dialog = page.locator(".ant-modal").last();
    await expect(dialog.locator(".ant-modal-title")).toHaveText("填报设备状态");
    /* 候选设备只能是事业一部（数据范围），不得出现其他事业部。 */
    await dialog.locator(".ant-select").first().click();
    const options = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
    await expect(options.first()).toBeVisible();
    const labels = await options.allInnerTexts();
    expect(labels.every((label) => label.includes("事业一部"))).toBe(true);
    /* 选一台当天尚未填报的设备（避开第一条，它已被重复提交用例占用）。 */
    const target = options.nth(5);
    const targetLabel = await target.innerText();
    const targetCode = targetLabel.split("｜")[0]!.trim();
    await target.click();
    const today = new Date().toISOString().slice(0, 10);
    await dialog.getByRole("button", { name: /确\s*定/ }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    /* 新增成功后：列表出现新记录（设备编号 + 当天日期）。 */
    const row = page.locator(".kdos-data-table-shell .ant-table-tbody tr.ant-table-row").filter({ hasText: targetCode }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(today);
    await page.screenshot({ path: testInfo.outputPath("create-success.png") });
  });

  test("重复日期：弹窗保持打开且显示持久错误原因（不再“点了没反应”）", async ({ page }, testInfo) => {
    await login(page);
    await page.goto("/equipment-status-report");
    await expect(page.getByRole("heading", { name: "设备状态填报" })).toBeVisible({ timeout: 20_000 });
    /* 先用 API 直接造一条当天记录，再在界面重复提交同一天。 */
    const created = await page.evaluate(async () => {
      const token = localStorage.getItem("accessToken");
      const options = await (await fetch("/api/v1/equipment/status-options", { headers: { authorization: `Bearer ${token}` } })).json();
      const equipment = options.equipment?.[0];
      if (!equipment) return null;
      const body = { equipmentId: equipment.id, reportDate: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), runtimeMinutes: 300, faultMinutes: 0, faultReason: null };
      const first = await fetch("/api/v1/equipment/status-reports", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { equipment, body, status: first.status };
    });
    test.skip(!created, "当前账号没有可填报设备");
    await page.getByRole("button", { name: /填报设备状态/ }).click();
    const dialog = page.locator(".ant-modal").last();
    await dialog.locator(".ant-select").first().click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option").first().click();
    await dialog.locator(".ant-picker-input input").first().fill(created!.body.reportDate);
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: /确\s*定/ }).click();
    /* 弹窗必须保持打开，并给出持久、可读的失败原因。 */
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("保存失败")).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText(/已经填报|只能填报|已停用|不允许/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("duplicate-error.png") });
  });

  test("安全边界：伪造其他事业部设备 ID → 403（前端下拉不会给出该设备）", async ({ page }) => {
    await login(page);
    await page.goto("/equipment-status-report");
    await expect(page.getByRole("heading", { name: "设备状态填报" })).toBeVisible({ timeout: 20_000 });
    const result = await page.evaluate(async () => {
      const token = localStorage.getItem("accessToken");
      const response = await fetch("/api/v1/equipment/status-reports", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ equipmentId: "01a0654f-40ed-760b-9d0d-612a2eba9801", reportDate: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10), runtimeMinutes: 300, faultMinutes: 0, faultReason: null })
      });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    });
    expect(result.status).toBe(403);
    expect(String(result.body?.message ?? "")).toContain("超出事业部数据范围");
  });
});
