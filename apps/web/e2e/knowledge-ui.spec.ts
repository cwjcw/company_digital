import { expect, test, type Page } from "@playwright/test";
import { tablePermissionFieldsFor } from "@kdos/contracts";
// Runtime account credentials must never enter traces, screenshots or recordings.
test.use({ trace: "off", screenshot: "off", video: "off" });
const admin = {
  sub: "fixture-admin",
  username: "fixture-admin",
  displayName: "测试管理员",
  permissions: ["*"],
  isSystemAdmin: true,
  moduleAdminCodes: ["knowledge"],
};
const viewer = {
  sub: "fixture-viewer",
  username: "fixture-viewer",
  displayName: "测试员工",
  permissions: [
    "knowledge-spaces:*:read",
    "knowledge-pages:*:read",
    ...["knowledge-spaces", "knowledge-pages"].flatMap((r) =>
      tablePermissionFieldsFor(r as never).map((f) => `${r}:${f.key}:read`),
    ),
  ],
};
async function fixtures(
  page: Page,
  user: typeof viewer | typeof admin = admin,
) {
  const writes: { path: string; body: any }[] = [],
    drafts = new Map<string, any>(),
    published = new Map<string, any>(),
    history = new Map<string, any[]>();
  let count = 0;
  const space = {
    id: "hr",
    code: "HR",
    name: "人力资源",
    description: "",
    sortOrder: 0,
    status: "ACTIVE",
    version: 1,
    accessLevel: user === admin ? "FULL_ACCESS" : "VIEWER",
    canCreate: user === admin,
    canManage: user === admin,
  };
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace("/api/v1", "");
    let result: any = [];
    if (path === "/auth/login")
      result = {
        accessToken: "intercepted-browser-fixture",
        refreshToken: "fixture",
        user,
      };
    else if (path === "/auth/me") result = user;
    else if (path === "/knowledge/spaces") result = [space];
    else if (path === "/knowledge/options")
      result = { users: [], roles: [], organizations: [] };
    else if (["POST", "PATCH", "DELETE"].includes(req.method())) {
      const body = path.endsWith("/files") ? null : req.postDataJSON();
      writes.push({ path, body });
      if (path === "/knowledge/pages") {
        const id = `page${++count}`;
        drafts.set(id, {
          id,
          spaceId: "hr",
          parentId: body.parentId ?? null,
          title: "未命名页面",
          slug: id,
          status: "DRAFT",
          version: 1,
          sortOrder: 0,
          tags: [],
          attachments: [],
          content: { type: "doc", content: [{ type: "paragraph" }] },
          canEdit: true,
          canManage: true,
          breadcrumb: [{ id: "hr", title: "人力资源" }],
        });
        result = { id, version: 1 };
      } else {
        const id = path.split("/")[3],
          draft = drafts.get(id);
        if (path.endsWith("/files")) {
          const attachment = {
            id: `file${id}`,
            pageId: id,
            originalName: "制度.txt",
            contentType: "text/plain",
            size: 6,
          };
          draft.attachments.push(attachment);
          draft.version++;
          result = { attachment, version: draft.version };
        } else if (path.endsWith("/publish")) {
          if (body.expectedVersion !== draft.version) {
            await route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({ message: "版本冲突" }),
            });
            return;
          }
          draft.version++;
          draft.status = "PUBLISHED";
          draft.publishedVersion = (draft.publishedVersion ?? 0) + 1;
          draft.publishedVersionId = `${id}-v${draft.publishedVersion}`;
          draft.breadcrumb = [
            { id: "hr", title: "人力资源" },
            { id, title: draft.title },
          ];
          published.set(id, structuredClone(draft));
          history.set(id, [...(history.get(id) ?? []), structuredClone(draft)]);
          result = {
            id,
            version: draft.version,
            publishedVersion: draft.publishedVersion,
          };
        } else if (draft) {
          Object.assign(draft, body, { version: draft.version + 1 });
          result = { id, version: draft.version };
        }
      }
    } else if (path.includes("/tree")) {
      const list =
          url.searchParams.get("mode") === "working" ? drafts : published,
        parent = url.searchParams.get("parentId");
      const rows = [...list.values()]
        .filter((p) => p.parentId === (parent ?? null))
        .map((p) => ({
          ...p,
          hasChildren: [...list.values()].some((c) => c.parentId === p.id),
        }));
      result = { rows, total: rows.length };
    } else if (path.endsWith("/versions")) {
      result = (history.get(path.split("/")[3]) ?? []).map((p) => ({
        id: p.publishedVersionId,
        title: p.title,
        publishedVersion: p.publishedVersion,
        publishedAt: "2026-10-08",
      }));
    } else if (path.startsWith("/knowledge/pages/")) {
      const id = path.split("/")[3];
      result = url.searchParams.get("versionId")
        ? (history.get(id) ?? []).find(
            (p) => p.publishedVersionId === url.searchParams.get("versionId"),
          )
        : url.searchParams.get("mode") === "working"
          ? drafts.get(id)
          : published.get(id);
      if (result && user === viewer)
        result = { ...result, canEdit: false, canManage: false };
    } else if (path === "/knowledge/search") {
      const rows = [...published.values()].filter((p) =>
        p.title.includes(url.searchParams.get("search") ?? ""),
      );
      result = { rows, total: rows.length };
    } else if (path.startsWith("/knowledge/files/")) {
      await route.fulfill({ contentType: "text/plain", body: "制度" });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result ?? null),
    });
  });
  await page.goto("/");
  await page.getByLabel("用户名").fill("browser-fixture");
  await page.getByLabel("密码").fill("browser-fixture");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator(".portal-module-grid")).toBeVisible();
  return { writes, drafts, published, history };
}
test("Portal, immediate pageId, real TipTap autosave, direct upload and V1/V2 immutable history", async ({
  page,
}) => {
  const s = await fixtures(page);
  await page.getByRole("button", { name: "进入知识库" }).click();
  await expect(page.getByText("人力资源", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建", exact: true }).hover();
  await page.getByText("在线编写",{exact:true}).click();
  await expect(page).toHaveURL(/pages\/page1\?edit=1/);
  await expect(
    page.getByRole("button", { name: "上传附件 / 图片" }),
  ).toBeEnabled();
  await page.getByLabel("页面标题", { exact: true }).fill("员工请假管理办法");
  await page.locator(".tiptap").fill("年度绩效考核制度与请假流程");
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  expect(s.drafts.get("page1").content.type).toBe("doc");
  await page.locator('input[type="file"]').setInputFiles({
    name: "制度.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("制度"),
  });
  await expect(
    page.getByRole("button", { name: "制度.txt", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^发\s*布$/ }).click();
  await expect(page.getByText("发布版本 v1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "页面更多操作" }).click();
  await page.getByText("编辑页面", { exact: true }).click();
  await page.getByLabel("页面标题", { exact: true }).fill("V2制度标题");
  await page.locator(".tiptap").fill("第二版正文");
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  expect(s.published.get("page1").title).toBe("员工请假管理办法");
  await page.getByRole("button", { name: "发布新版本" }).click();
  await expect(page.getByText("发布版本 v2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "页面更多操作" }).click();
  await page.getByText("历史版本", { exact: true }).click();
  await page.getByRole("button", { name: /v1 · 员工请假/ }).click();
  await expect(
    page.getByRole("heading", { name: "员工请假管理办法", exact: true }),
  ).toBeVisible();
  expect(s.history.get("page1")?.length).toBe(2);
  expect(
    s.writes.some(
      (w) => w.path.includes("articles") || w.path.includes("categories"),
    ),
  ).toBe(false);
});
test("real TipTap table/callout/code and child page creation", async ({
  page,
}) => {
  const s = await fixtures(page);
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "新建", exact: true }).hover();
  await page.getByText("在线编写",{exact:true}).click();
  await page.getByLabel("页面标题", { exact: true }).fill("制度目录");
  await page.getByRole("button", { name: /^表\s*格$/ }).click();
  await expect(page.locator(".tiptap table")).toBeVisible();
  await page.getByRole("button", { name: "提示块" }).click();
  await expect(page.locator(".tiptap aside")).toBeVisible();
  await page.getByRole("button", { name: "立即保存" }).click();
  expect(JSON.stringify(s.drafts.get("page1").content)).toContain("table");
  await page.getByRole("button", { name: /^发\s*布$/ }).click();
  await page.getByRole("button", { name: "页面更多操作" }).click();
  await page.getByText("新建子页面", { exact: true }).click();
  await expect(page).toHaveURL(/page2\?edit=1/);
  expect(s.drafts.get("page2").parentId).toBe("page1");
});
test("ordinary employee has Space tree without editor and creation controls", async ({
  page,
}) => {
  await fixtures(page, viewer);
  await page.getByRole("button", { name: "进入知识库" }).click();
  await expect(page.getByText("人力资源", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新建", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "上传附件 / 图片" }),
  ).toHaveCount(0);
});
test.describe("production credential acceptance", () => {
  test("production existing login and Knowledge permissions", async ({
    page,
  }) => {
    const username = process.env.KNOWLEDGE_E2E_USERNAME,
      password = process.env.KNOWLEDGE_E2E_PASSWORD;
    test.skip(
      !username || !password,
      "未提供本轮授权的运行时凭据；不复用限PMC Phase5的凭据",
    );
    try {
      await page.goto("/");
      await page.getByLabel("用户名").fill(username!);
      await page.getByLabel("密码").fill(password!);
      await page.locator('button[type="submit"]').click();
      await expect(page.locator(".portal-module-grid")).toBeVisible();
      await page.getByRole("button", { name: "进入知识库" }).click();
      await expect(page.getByText("人力资源", { exact: true })).toBeVisible();
    } catch {
      throw new Error("E2E 登录/权限验证失败");
    }
  });
});
