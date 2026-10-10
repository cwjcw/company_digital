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
    else if (path === "/knowledge/capabilities") result = Object.fromEntries(["canManage", "canCreatePages", "canEditPages", "canManagePages", "canCreateSpaces", "canManageSpaces", "canArchive", "canTrash"].map(key => [key, user === admin]));
    else if (path === "/knowledge/spaces") result = [space];
    else if (path.endsWith("/locations")) {
      const selectedId = url.searchParams.get("selectedId");
      const rows = [...drafts.values()].filter(p => selectedId ? p.id === selectedId : p.parentId === (url.searchParams.get("parentId") ?? null));
      result = { rows, total: rows.length, page: 1, pageSize: 100 };
    }
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
      const allRows = [...list.values()]
        .filter((p) => p.parentId === (parent ?? null))
        .map((p) => ({
          ...p,
          hasChildren: [...list.values()].some((c) => c.parentId === p.id),
        }));
      const pageNumber = Number(url.searchParams.get("page") ?? 1), size = Number(url.searchParams.get("pageSize") ?? 100);
      result = { rows: allRows.slice((pageNumber-1)*size,pageNumber*size), total: allRows.length, page: pageNumber, pageSize: size };
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
      if (result && !url.searchParams.get("versionId") && user === admin) {
        const fields = ["title", "content", "description", "tags", "attachments", "contentMode"];
        const working = drafts.get(id), snapshot = published.get(id);
        result = { ...result, hasUnpublishedChanges: !snapshot || fields.some(key => JSON.stringify(working?.[key]) !== JSON.stringify(snapshot[key])) };
      }
      if (result && user === viewer)
        result = { ...result, canEdit: false, canManage: false };
    } else if (path === "/knowledge/pages") {
      const allRows = [...published.values()].sort((a,b)=>String(b.publishedAt??"").localeCompare(String(a.publishedAt??""))); const pageNumber=Number(url.searchParams.get("page")??1), size=Number(url.searchParams.get("pageSize")??10); result = {rows:allRows.slice((pageNumber-1)*size,pageNumber*size),total:allRows.length,page:pageNumber,pageSize:size};
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
  await page.getByRole("link", { name: "进入知识管理", exact: true }).click();
  await page.getByRole("button", { name: "新建知识", exact: true }).hover();
  await page.getByText("在线编写",{exact:true}).click();
  await page.getByRole("button", { name: "创建并编写" }).click();
  await expect(page).toHaveURL(/pages\/page1\?edit=1/);
  await expect(
    page.getByRole("button", { name: "上传附件 / 图片" }),
  ).toBeEnabled();
  // Simulate pre-existing API metadata; the editor must leave it untouched.
  s.drafts.get("page1").tags = ["已有标签"];
  await expect(page.getByLabel("页面标签", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("页面路径")).toHaveText("人力资源");
  expect(await page.evaluate(() => {
    const path = document.querySelector('[aria-label="页面路径"]')!;
    const title = document.querySelector('[aria-label="页面标题"]')!;
    return Boolean(path.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
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
  await page.getByRole("button", { name: /^编\s*辑$/ }).click();
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
  expect(s.history.get("page1")?.map((version) => version.tags)).toEqual([
    ["已有标签"], ["已有标签"],
  ]);
  expect(s.writes.filter((write) => write.path === "/knowledge/pages/page1")
    .every((write) => !("tags" in write.body))).toBe(true);
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
  await page.getByRole("link", { name: "进入知识管理", exact: true }).click();
  await page.getByRole("button", { name: "新建知识", exact: true }).hover();
  await page.getByText("在线编写",{exact:true}).click();
  await page.getByRole("button", { name: "创建并编写" }).click();
  await page.getByLabel("页面标题", { exact: true }).fill("制度目录");
  await page.getByRole("button", { name: /^表\s*格$/ }).click();
  await expect(page.locator(".tiptap table")).toBeVisible();
  await page.getByRole("button", { name: "提示块" }).click();
  await expect(page.locator(".tiptap aside")).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect(JSON.stringify(s.drafts.get("page1").content)).toContain("table");
  await page.getByRole("button", { name: /^发\s*布$/ }).click();
  await page.getByRole("button", { name: "页面更多操作" }).click();
  await page.getByText("新建子页面", { exact: true }).click();
  await page.getByRole("button", { name: "创建并编写" }).click();
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
    page.getByRole("button", { name: "新建知识", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "上传附件 / 图片" }),
  ).toHaveCount(0);
  for (const name of ["空间设置", "已归档页面", "回收站"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
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

test("sticky editor actions, direct draft publication and title-only reader publication with a fresh server version", async ({ page }) => {
  const state = await fixtures(page);
  await page.getByRole("button", { name: "进入知识库" }).click();
  await page.getByRole("link", { name: "进入知识管理", exact: true }).click();
  await page.getByRole("button", { name: "新建知识", exact: true }).hover();
  await page.getByText("在线编写", { exact: true }).click();
  await page.getByRole("button", { name: "创建并编写" }).click();
  await page.getByLabel("页面标题", { exact: true }).fill("直接发布验收");
  await page.locator(".tiptap").fill(Array.from({ length: 100 }, (_, i) => `第${i}行长正文`).join("\n"));
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(async () => {
    const rect = await page.getByRole("toolbar", { name: "页面编辑操作" }).boundingBox();
    return Boolean(rect && rect.y >= 0 && rect.y < 20);
  }).toBe(true);
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "发布", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "保存并返回" }).click();
  await expect(page.locator(".knowledge-reader")).toBeVisible();
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.getByText("发布版本 v1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发布新版本" })).toHaveCount(0);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByRole("button", { name: "发布新版本" })).toHaveCount(0);
  await expect(page.getByText(/存在工作草稿|有未发布修改/)).toHaveCount(0);
  await page.getByLabel("页面标题", { exact: true }).fill("仅修改标题的新版本");
  await page.getByRole("button", { name: "保存并返回" }).click();
  await expect(page.locator(".knowledge-reader h1")).toHaveText("直接发布验收");
  const freshVersion = ++state.drafts.get("page1").version;
  await page.getByRole("button", { name: "发布新版本" }).click();
  await expect(page.locator(".knowledge-reader h1")).toHaveText("仅修改标题的新版本");
  await expect(page.getByText("发布版本 v2", { exact: true })).toBeVisible();
  expect(state.writes.filter(w => w.path.endsWith("/publish")).at(-1)?.body.expectedVersion).toBe(freshVersion);
  expect(state.history.get("page1")![0].title).toBe("直接发布验收");
  await expect(page.getByRole("button", { name: "发布新版本" })).toHaveCount(0);
});

test("employee portal, published search, stable reading, 105-row lazy directory and mobile layout", async ({ page }) => {
  const state = await fixtures(page, viewer);
  for (let index=1;index<=105;index++) state.published.set(`p${index}`, {
    id:`p${index}`, spaceId:"hr", parentId:null, title:`正式制度${index}`, contentMode:"RICH_TEXT", status:"PUBLISHED", publishedAt:`2026-10-${String(index%9+1).padStart(2,"0")}T01:00:00+08:00`,
    content:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"正式已发布正文"}]}]},spaceName:"人力资源",breadcrumb:[{id:"hr",title:"人力资源"},{id:`p${index}`,title:`正式制度${index}`}],description:"已发布摘要"
  });
  state.drafts.set("p1",{...state.published.get("p1"),title:"未发布秘密标题"});
  const reads:string[]=[];page.on("request",r=>{if(r.url().includes("/knowledge/"))reads.push(r.url());});
  await page.getByRole("button",{name:"进入知识库"}).click();
  await expect(page.getByRole("heading",{name:"凯南知识库",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"进入知识管理"})).toHaveCount(0);
  await expect(page.locator(".knowledge-result-title")).toHaveCount(10);
  await page.getByRole("button",{name:"查看更多",exact:true}).click();
  await expect(page).toHaveURL(/page=2/);await expect(page.locator(".knowledge-result-title")).toHaveCount(10);
  await page.getByRole("searchbox",{name:"搜索知识",exact:true}).fill("正式制度1");
  await page.getByRole("searchbox",{name:"搜索知识",exact:true}).press("Enter");
  await expect(page.getByRole("heading",{name:"搜索结果",exact:true})).toBeVisible();
  await expect(page.getByText("未发布秘密标题",{exact:true})).toHaveCount(0);
  await page.goto("/knowledge/spaces/hr");
  await expect(page.locator(".knowledge-directory").getByRole("button",{name:"正式制度100",exact:true})).toBeVisible();
  await page.locator(".knowledge-directory").getByRole("button",{name:"加载更多",exact:true}).click();
  await expect(page.locator(".knowledge-directory").getByRole("button",{name:"正式制度105",exact:true})).toBeVisible();
  await page.goto("/knowledge/pages/p1");await expect(page.getByRole("heading",{name:"正式制度1",exact:true})).toBeVisible();
  await expect(page.getByText("正式已发布正文",{exact:true})).toBeVisible();
  for(const name of ["编辑","发布","页面更多操作","新建知识"])await expect(page.getByRole("button",{name,exact:true})).toHaveCount(0);
  expect(reads.some(url=>url.includes("mode=working"))).toBe(false);
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.goto("/knowledge");await expect(page.getByRole("searchbox",{name:"搜索知识",exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test("reader direct management and old working links are denied without requesting drafts", async ({ page }) => {
  await fixtures(page,viewer);
  const drafts:string[]=[];page.on("request",r=>{if(r.url().includes("/api/v1/") && r.url().includes("mode=working"))drafts.push(r.url());});
  for(const route of ["/knowledge/manage","/knowledge/manage/pages/p1?edit=1","/knowledge/manage/spaces","/knowledge/manage/trash"]){
    await page.goto(route);await expect(page.getByText("当前权限不能进入此知识管理区域",{exact:true})).toBeVisible();
  }
  await page.goto("/knowledge/pages/p1?mode=working&edit=1");await expect(page.getByText("当前权限不能查看或编辑工作草稿",{exact:true})).toBeVisible();
  expect(drafts).toHaveLength(0);
});

test("no Knowledge read hides portal module and rejects direct access", async ({page})=>{
  await fixtures(page,{...viewer,permissions:[]});
  await expect(page.getByRole("button",{name:"进入知识库"})).toHaveCount(0);
  await page.goto("/knowledge");await expect(page.getByText("当前权限组不能查看知识库",{exact:true})).toBeVisible();
});
