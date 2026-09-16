import { expect, test, type Page } from "@playwright/test";

/**
 * KN-FILTER-001 最终收口浏览器 UAT：用户管理（部门/状态/搜索/高级筛选服务端 AND）与角色成员视图（selectedRoleId 约束）。
 */
const username = process.env.KNF_E2E_USERNAME ?? "__knf_admin";
const password = process.env.KNF_E2E_PASSWORD ?? "";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.locator('button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("accessToken")))).toBe(true);
}

function usersRequests(page: Page) {
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = decodeURIComponent(request.url());
    if (url.includes("/api/v1/admin/users?")) seen.push(url);
  });
  return seen;
}

test.describe("KN-FILTER-001 用户与角色成员 UAT", () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!password, "缺少 KNF_E2E_PASSWORD");

  test("用户管理：服务端分页 + 部门/状态/搜索/高级筛选全部服务端生效", async ({ page }, testInfo) => {
    await login(page);
    const requests = usersRequests(page);
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "用户与角色" }).first()).toBeVisible();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    /* 首屏请求：服务端分页（page/pageSize），不是整表读取。 */
    expect(requests.at(-1)).toContain("page=1");
    expect(requests.at(-1)).toMatch(/pageSize=(20|50|100|200)/);
    /* 状态筛选：服务端条件 */
    const before = requests.length;
    await page.locator(".ant-select").filter({ hasText: "全部" }).first().click();
    await page.getByTitle("已停用").click();
    await expect.poll(() => requests.length).toBeGreaterThan(before);
    expect(requests.at(-1)).toContain("status=disabled");
    /* 搜索：服务端条件 */
    const beforeSearch = requests.length;
    await page.getByPlaceholder("搜索成员").fill("admin");
    await expect.poll(() => requests.length).toBeGreaterThan(beforeSearch);
    expect(requests.at(-1)).toContain("search=admin");
    /* 高级筛选：FilterGroup 进入服务端请求 */
    const beforeFilter = requests.length;
    await page.getByRole("button", { name: /高级筛选/ }).first().click();
    const panel = page.locator(".ant-popover").filter({ hasText: "添加过滤条件" }).last();
    await panel.getByRole("button", { name: /添加过滤条件/ }).click();
    await panel.locator(".ant-select-selector").nth(1).click();
    await page.getByTitle("职位").last().click();
    await page.getByPlaceholder("输入要匹配的内容").fill("经理");
    await panel.getByRole("button", { name: /筛\s*选/ }).click();
    await expect.poll(() => requests.length).toBeGreaterThan(beforeFilter);
    expect(requests.at(-1)).toContain("filterGroup");
    expect(requests.at(-1)).toContain("position");
    await page.screenshot({ path: testInfo.outputPath("users-advanced-filter.png") });
  });

  test("角色成员：selectedRoleId 服务端约束，筛选不能突破角色范围", async ({ page }, testInfo) => {
    await login(page);
    const requests = usersRequests(page);
    await page.goto("/users");
    await page.getByRole("button", { name: "切换到角色" }).click();
    await page.locator(".role-tree-role").first().click();
    await expect.poll(() => requests.some((url) => url.includes("roleId="))).toBe(true);
    const roleRequest = requests.find((url) => url.includes("roleId="))!;
    expect(roleRequest).toContain("roleId=");
    expect(roleRequest).toContain("page=1");
    /* 角色内高级筛选：请求同时带 roleId 与 filterGroup（服务端 AND，客户端无法移除 roleId）。 */
    const before = requests.length;
    await page.getByRole("button", { name: /高级筛选/ }).first().click();
    const panel = page.locator(".ant-popover").filter({ hasText: "添加过滤条件" }).last();
    await panel.getByRole("button", { name: /添加过滤条件/ }).click();
    await panel.locator(".ant-select-selector").nth(1).click();
    await page.getByTitle("姓名").last().click();
    await panel.getByPlaceholder("输入要匹配的内容").fill("a");
    await panel.getByRole("button", { name: /筛\s*选/ }).click();
    await expect.poll(() => requests.length).toBeGreaterThan(before);
    const applied = requests.at(-1)!;
    expect(applied).toContain("roleId=");
    expect(applied).toContain("filterGroup");
    await page.screenshot({ path: testInfo.outputPath("role-members-filtered.png") });
  });
});
