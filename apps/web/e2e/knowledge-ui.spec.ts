import { expect, test, type Page } from "@playwright/test";
import { tablePermissionFieldsFor } from "@kdos/contracts";

// Browser interaction fixtures only. Every API request is intercepted; no production identity or writes.
const root = { id: "root", parentId: null, level: 1, code: "HR", name: "人力资源", enabled: true, sortOrder: 0, version: 1 };
const admin = { sub: "browser-admin", username: "browser-admin", displayName: "测试管理员", isSystemAdmin: true, permissions: ["*"], moduleAdminCodes: ["knowledge"] };
const ordinary = { sub: "browser-member", username: "browser-member", displayName: "测试员工", permissions: ["knowledge-articles:*:read", "knowledge-categories:*:read", ...["knowledge-articles", "knowledge-categories"].flatMap(code => tablePermissionFieldsFor(code as never).map(field => `${code}:${field.key}:read`))] };
async function fixtures(page: Page, user: typeof ordinary | typeof admin = admin) {
  const categories: any[] = [root]; let draft: any; let published: any; const writes: { path: string; body: any }[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace("/api/v1", "");
    let result: any = [];
    if (path === "/auth/login") result = { accessToken: "intercepted-browser-fixture", refreshToken: "fixture", user };
    else if (path === "/auth/me") result = user;
    else if (path === "/knowledge/options") result = { users: [{ id: "employee-id", label: "员工甲" }], roles: [], organizations: [] };
    else if (request.method() === "POST" || request.method() === "PATCH") {
      const body = path.endsWith("/attachments") ? null : request.postDataJSON(); writes.push({ path, body });
      if (path === "/knowledge/categories") { categories.push({ ...root, ...body, id: "child", level: 2 }); result = { id: "child", version: 1 }; }
      else if (path === "/knowledge/articles") { draft = { ...body, id: "article", status: "DRAFT", version: 1, attachments: [] }; result = { id: "article", version: 1 }; }
      else if (path.endsWith("/attachments")) { const attachment = { id: "file", articleId: "article", originalName: "制度.txt", contentType: "text/plain", size: 6 }; draft.attachments.push(attachment); draft.version++; result = { attachment, version: draft.version }; }
      else if (path.endsWith("/publish")) { draft.version++; published = { ...structuredClone(draft), status: "PUBLISHED", publishedVersion: 1 }; result = { id: "article", version: draft.version, publishedVersion: 1 }; }
      else { draft = { ...draft, ...body, version: draft.version + 1 }; result = { id: "article", version: draft.version }; }
    } else if (path === "/knowledge/categories") result = categories;
    else if (path === "/knowledge/articles") result = { rows: published ? [published] : [], total: published ? 1 : 0, page: 1, pageSize: 100 };
    else if (path === "/knowledge/articles/article") result = url.searchParams.get("mode") === "manage" ? draft : published;
    else if (path === "/knowledge/attachments/file") { await route.fulfill({ contentType: "text/plain", body: "制度" }); return; }
    else if (path === "/table-exports/capabilities") result = [];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
  });
  await page.goto("/"); await page.getByLabel("用户名").fill("browser-fixture"); await page.getByLabel("密码").fill("browser-fixture"); await page.locator('button[type="submit"]').click(); await expect(page.locator(".portal-module-grid")).toBeVisible();
  return { categories, writes };
}

test("independent Portal route and administrator manually creates a child", async ({ page }) => {
  const state = await fixtures(page); await page.getByRole("button", { name: "进入知识库" }).click(); await expect(page).toHaveURL(/\/knowledge$/);
  await expect(page.getByText("人力资源", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "新增二级分类" }).click();
  await page.getByLabel("分类名称").fill("公司制度"); await page.getByRole("button", { name: /确\s*定/ }).click();
  await expect(page.getByText("公司制度", { exact: true })).toBeVisible(); expect(state.writes[0]).toMatchObject({ path: "/knowledge/categories", body: { parentId: "root", name: "公司制度" } });
});

test("real TipTap editor saves structured Chinese draft, uploads and publishes", async ({ page }) => {
  const state = await fixtures(page); await page.goto("/knowledge/manage/articles/new");
  await page.getByLabel("标题", { exact: true }).fill("员工请假管理办法");
  await page.locator(".tiptap").fill("年度员工绩效考核制度与请假流程");
  await page.getByRole("button", { name: /加\s*粗/ }).click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click(); await expect(page).toHaveURL(/\/articles\/article\/edit$/);
  await expect(page.getByRole("button", { name: "上传附件/图片" })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({ name: "制度.txt", mimeType: "text/plain", buffer: Buffer.from("制度") });
  await expect(page.getByRole("button", { name: "制度.txt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^发\s*布$/ }).click(); await expect(page).toHaveURL(/\/knowledge\/articles\/article$/);
  await expect(page.getByText("年度员工绩效考核制度与请假流程", { exact: true })).toBeVisible(); await expect(page.getByText("版本 v1", { exact: true })).toBeVisible();
  const saved = state.writes.find(row => row.path === "/knowledge/articles")!; expect(saved.body.content.type).toBe("doc"); expect(saved.body.contentText).toBeUndefined(); expect(state.writes.find(row => row.path.endsWith("/publish"))?.body.expectedVersion).toBe(3);
});

test("ordinary employee sees HR tree without creation/editor controls", async ({ page }) => {
  await fixtures(page, ordinary); await page.getByRole("button", { name: "进入知识库" }).click(); await expect(page.getByText("人力资源", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增二级分类" })).toHaveCount(0); await expect(page.getByRole("button", { name: "新建文章" })).toHaveCount(0);
  await page.goto("/knowledge/manage/articles/new"); await expect(page.getByText("当前权限组没有文章编辑权限")).toBeVisible();
});

test("existing login can open deployed knowledge root", async ({ page }) => {
  const username = process.env.KNOWLEDGE_E2E_USERNAME; const password = process.env.KNOWLEDGE_E2E_PASSWORD;
  test.skip(!username || !password, "需要现有知识库测试账号；不创建生产账号或修改权限");
  await page.goto("/"); await page.getByLabel("用户名").fill(username!); await page.getByLabel("密码").fill(password!); await page.locator('button[type="submit"]').click(); await expect(page.locator(".portal-module-grid")).toBeVisible();
  await page.getByRole("button", { name: "进入知识库" }).click(); await expect(page.getByText("人力资源", { exact: true })).toBeVisible();
});
