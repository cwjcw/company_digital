import { expect, test, type Page } from "@playwright/test";

const user = { sub: "u-rd-admin", username: "admin", displayName: "研发管理员", roles: ["系统管理员"], isSystemAdmin: true, moduleAdminCodes: ["rd"], permissions: ["*"], divisions: "*", mustChangePassword: false };

async function mockRdApi(page: Page) {
  await page.route("**/api/v1/auth/login", (route: any) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ accessToken: "rd-test-token", refreshToken: "refresh", user }) }));
  await page.route("**/api/v1/auth/me", (route: any) => route.fulfill({ contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/api/v1/table-filters/resources", (route: any) => route.fulfill({ contentType: "application/json", body: JSON.stringify([]) }));
  await page.route("**/api/v1/rd/items**", (route: any) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ rows: [], total: 0, page: 1, pageSize: 100 }) }));
  await page.route("**/api/v1/rd/items/status", (route: any) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ activeItemCount: 574544, lastSuccessfulSyncAt: "2026-09-29 19:11:57", latestSync: { status: "SUCCESS", finishedAt: "2026-09-29 19:11:57" } }) }));
  await page.route("**/api/v1/rd/material-duplicates/scans/latest", (route: any) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "rd-test-scan", status: "COMPLETE", scanMode: "FULL", rows: 574544, itemCount: 574544, finishedAt: "2026-09-29 19:20:00", counts: { exact: 21210, similar: 31682, missing: 46025, code: 9 }, comparedPairs: 588583, skippedBlocks: 56, skippedPairs: 18158444, totalGroups: 31682, page: 1, pages: 634 }) }));
  await page.route("**/api/v1/rd/material-duplicates/scans", async (route: any) => {
    if (route.request().method() === "POST") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "rd-test-scan", status: "RUNNING", stage: "读取物料" }) });
    return route.continue();
  });
  await page.route("**/api/v1/rd/material-duplicates/scans/rd-test-scan?*", (route: any) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "rd-test-scan", status: "COMPLETE", rows: 574544, finishedAt: "2026-09-29 19:20:00", counts: { exact: 21210, similar: 31682, missing: 46025, code: 9 }, comparedPairs: 588583, skippedBlocks: 56, skippedPairs: 18158444, totalGroups: 31682, page: 1, pages: 634, groups: [{ id: "g-1", groupNo: 1, kind: "similar", score: 93.2, reason: "名称和规格接近", warnings: ["材质需确认"], memberCount: 2, distinctCodes: 2, records: [{ row: 10, code: "A-304", name: "304内六角螺钉", spec: "M6*20" }, { row: 20, code: "B-201", name: "201内六角螺钉", spec: "M6*20" }] }] }) }));
}

test("研发中心一物多码检测全量扫描与 A/B 对照", async ({ page }) => {
  await mockRdApi(page);
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("test");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator(".portal-module-grid")).toBeVisible();
  await expect(page.getByText("R&D CENTER", { exact: true })).toHaveCount(0);

  await page.goto("/rd/material-duplicates");
  await expect(page.getByText("全量查重", { exact: true })).toBeVisible();
  await expect(page.getByText("查重结果", { exact: true })).toBeVisible();
  await expect(page.getByText("对当前物料库全部物料进行查重分析，识别可能存在的一物多码、名称规格一致、同名规格缺失及同品号多记录等情况，结果供人工核对。", { exact: true })).toBeVisible();
  await expect(page.getByText("新物料快速检索", { exact: true })).toHaveCount(0);
  await expect(page.getByText("历史物料检测", { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder("品名（主要输入）")).toHaveCount(0);
  await expect(page.getByText("Top", { exact: true })).toHaveCount(0);
  await expect(page.getByText("历史物料全库检测", { exact: true })).toHaveCount(0);
  await expect(page.getByTitle("高相似")).toBeVisible();

  await expect(page.getByRole("button", { name: "更新查重" })).toBeVisible();
  await expect(page.getByRole("button", { name: "全量重建" })).toBeVisible();
  await page.getByRole("button", { name: "更新查重" }).click();
  await expect(page.getByText("扫描完成", { exact: true })).toBeVisible();
  await expect(page.locator(".rd-scan-status")).toContainText("查重更新已完成。");
  await expect(page.getByText("已比较候选对", { exact: true })).toBeVisible();
  await expect(page.getByText("已跳过候选分组", { exact: true })).toBeVisible();
  await expect(page.getByText("已跳过候选对", { exact: true })).toBeVisible();
  await expect(page.getByText("complete", { exact: true })).toHaveCount(0);
  await expect(page.getByText("compared pairs", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A · A-304", { exact: true })).toBeVisible();
  await expect(page.getByText("B · B-201", { exact: true })).toBeVisible();
  await expect(page.locator(".rd-compare-meta").first()).toContainText("名称和规格接近");
});

test("研发中心物料数据页保留总数与搜索字段入口", async ({ page }) => {
  await mockRdApi(page);
  await page.goto("/");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("test");
  await page.locator('button[type="submit"]').click();
  await page.goto("/rd/items");
  await expect(page.getByText("当前物料 574,544", { exact: true })).toBeVisible();
  await expect(page.getByText("当前筛选 0", { exact: true })).toBeVisible();
  await expect(page.getByText("搜索字段", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("搜索品号、品名或规格")).toBeVisible();
});
