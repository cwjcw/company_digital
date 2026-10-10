import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablePermissionFieldsFor, type KnowledgePage } from "@kdos/contracts";
import { api } from "../../api";
import { downloadApiFile } from "../../shared/legacy-ui";
import { clearKnowledgeDraftCache } from "./knowledge-autosave";
import { uploadKnowledgeFile } from "./knowledge-file-upload";
import { KnowledgeManagement } from "./KnowledgePages";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { ModulePortal } from "../portal/ModulePortal";
vi.mock("./knowledge-file-upload", () => ({ uploadKnowledgeFile: vi.fn() }));
vi.mock("./KnowledgeFilePreview",()=>({KnowledgeFilePreview:()=> <div>文件预览</div>}));
vi.mock("../../api", async (original) => ({ ...(await original<object>()), api: vi.fn() }));
vi.mock("../../shared/legacy-ui", async (original) => ({
  ...(await original<object>()),
  downloadApiFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./KnowledgeContent", async (original) => ({
  ...(await original<object>()),
  KnowledgeRichEditor: ({ value, onChange, disabled }: any) => (
    <textarea
      aria-label="页面正文"
      disabled={disabled}
      value={value?.content?.[0]?.content?.[0]?.text ?? ""}
      onChange={(e) =>
        onChange({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: e.target.value }],
            },
          ],
        })
      }
    />
  ),
}));
const content = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "制度正文" }] },
  ],
};
const page: KnowledgePage = {
  id: "page",
  spaceId: "hr",
  parentId: null,
  title: "员工请假管理办法",
  slug: "page-page",
  sortOrder: 0,
  status: "PUBLISHED",
  version: 4,
  publishedVersion: 2,
  hasUnpublishedChanges: true,
  publishedVersionId: "v2",
  content,
  tags: ["休假"],
  canEdit: true,
  canManage: true,
  breadcrumb: [
    { id: "hr", title: "人力资源" },
    { id: "page", title: "员工请假管理办法" },
  ],
  attachments: [
    {
      id: "file",
      pageId: "page",
      originalName: "制度.txt",
      contentType: "text/plain",
      size: 2,
      sha256: "hash",
      createdAt: "2026-10-08",
    },
  ],
};
const admin = { sub: "admin", isSystemAdmin: true, permissions: ["*"] };
const viewer = {
  sub: "member",
  permissions: [
    "knowledge-pages:*:read",
    "knowledge-spaces:*:read",
    ...["knowledge-pages", "knowledge-spaces"].flatMap((r) =>
      tablePermissionFieldsFor(r as never).map((f) => `${r}:${f.key}:read`),
    ),
  ],
};
function mount(
  element: React.ReactNode = <KnowledgeManagement capabilities={{canManage:true,canCreatePages:true,canEditPages:true,canManagePages:true,canCreateSpaces:true,canManageSpaces:true,canArchive:true,canTrash:true}} />,
  session: any = admin,
  path = "/knowledge/manage",
  existingClient?: QueryClient,
) {
  localStorage.setItem("sessionUser", JSON.stringify(session));
  const client =
    existingClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/knowledge/manage/pages/:id" element={element} />
            <Route path="*" element={element} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  let server = { ...page };
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (init?.method) {
      server = { ...server, ...JSON.parse(typeof init.body === "string" ? init.body : "{}"), version: 5 };
      if (path.endsWith("/files"))
        return {
          attachment: {
            id: "uploaded",
            pageId: "page",
            originalName: "new.txt",
            contentType: "text/plain",
          },
          version: 5,
        } as never;
      return { id: "page", version: 5 } as never;
    }
    if (path.startsWith("/knowledge/spaces") && !path.includes("/tree"))
      return [
        {
          id: "hr",
          name: "人力资源",
          code: "HR",
          version: 1,
          status: "ACTIVE",
          accessLevel: "FULL_ACCESS",
          canCreate: true,
          canManage: true,
        },
      ] as never;
    if (path.includes("/tree")) return { rows: [page], total: 1 } as never;
    if (path.includes("/versions"))
      return [
        {
          id: "v1",
          title: "历史制度",
          publishedVersion: 1,
          publishedAt: "2026-10-07",
        },
      ] as never;
    if (path.startsWith("/knowledge/pages/page"))
      return path.includes("versionId=v1")
        ? { ...page, title: "历史制度", attachments: [] }
        : (server as never);
    if (path.startsWith("/knowledge/search"))
      return { rows: [page], total: 1 } as never;
    return [] as never;
  });
});
afterEach(() => {
  cleanup();
  clearKnowledgeDraftCache();
  localStorage.clear();
});
describe("Knowledge 2 Wiki", () => {
  it("keeps independent Portal entry", () => {
    const open = vi.fn();
    mount(
      <ModulePortal user={viewer} onOpen={open} onLogout={vi.fn()} />,
      viewer,
    );
    fireEvent.click(screen.getByRole("button", { name: "进入知识库" }));
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ id: "knowledge", path: "/knowledge" }),
    );
  });
  it("creates a persistent page immediately and enters inline editor", async () => {
    mount();
    fireEvent.mouseOver(await screen.findByRole("button", { name: "新建知识" }));
    fireEvent.click(await screen.findByText("在线编写"));
    fireEvent.click(await screen.findByRole("button", { name: "创建并编写" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/knowledge/pages",
        expect.objectContaining({
          method: "POST",
          body: '{"spaceId":"hr","parentId":null}',
        }),
      ),
    );
    expect(await screen.findByLabelText("页面标题")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "上传附件 / 图片" }),
    ).toBeEnabled();
  });
  it.each(["上传文件", "从文档导入为在线文章"])("opens %s from the unified menu with the same root location", async (label) => {
    mount();
    const menu = await screen.findByRole("button", { name: "新建知识" });
    expect(screen.queryByRole("button", { name: "导入" })).toBeNull();
    fireEvent.mouseOver(menu);
    fireEvent.click(await screen.findByText(label, { exact: true }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: label })).toBeVisible());
    expect(screen.getByLabelText("保存位置")).toHaveTextContent("人力资源 > 空间根目录");
    expect(screen.queryByLabelText("页面标签")).toBeNull();
    expect(screen.queryByLabelText("导入页面标签")).toBeNull();
  });
  it("waits for fresh working version before mounting a cached draft editor", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["knowledge", "page", "page", "working", undefined], {
      ...page,
      version: 1,
    });
    let release!: (value: KnowledgePage) => void;
    const fresh = new Promise<KnowledgePage>((resolve) => {
      release = resolve;
    });
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation((path, init) =>
      path === "/knowledge/pages/page?mode=working" && !init?.method
        ? (fresh as never)
        : base(path, init),
    );
    mount(undefined, admin, "/knowledge/manage/pages/page?edit=1", client);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/knowledge/pages/page?mode=working"),
    );
    expect(screen.queryByLabelText("页面标题")).toBeNull();
    release({ ...page, version: 9 });
    const title = await screen.findByLabelText("页面标题");
    fireEvent.change(title, { target: { value: "最新工作副本" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/knowledge/pages/page",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ title: "最新工作副本", expectedVersion: 9 }),
        }),
      ),
    );
  });
  it("published reader shows breadcrumbs/body/version and private download", async () => {
    mount(undefined, viewer, "/knowledge/manage/pages/page");
    expect(await screen.findByText("制度正文")).toBeVisible();
    expect(screen.getByText("发布版本 v2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "制度.txt" }));
    expect(downloadApiFile).toHaveBeenCalledWith(
      "/knowledge/files/file/original?mode=published",
      "制度.txt",
    );
  });
  it("readonly user does not see creation or edit actions", async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (p, i) => {
      const r: any = await base(p, i);
      if (p === "/knowledge/spaces")
        return r.map((s: any) => ({
          ...s,
          canCreate: false,
          canManage: false,
          accessLevel: "VIEWER",
        }));
      if (p.startsWith("/knowledge/pages/page"))
        return { ...r, canEdit: false, canManage: false };
      return r;
    });
    mount(undefined, viewer, "/knowledge/manage/pages/page");
    await screen.findByText("制度正文");
    expect(screen.queryByRole("button", { name: "新建知识" })).toBeNull();
    for (const name of ["空间设置", "已归档页面", "回收站"]) expect(screen.queryByRole("button", { name })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "页面更多操作" }));
    expect(screen.queryByText("编辑页面")).toBeNull();
    for (const name of ["页面权限", "新建子页面", "归档子树", "移到回收站", "移动 / 调整顺序"]) expect(screen.queryByText(name)).toBeNull();
  });
  it("search sends Chinese term and server pagination", async () => {
    mount();
    await screen.findByRole("button", { name: "新建知识" });
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索知识页面" }), {
      target: { value: "请假" },
    });
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "搜索知识页面" }), {
      key: "Enter",
      code: "Enter",
    });
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        expect.stringContaining("search=%E8%AF%B7%E5%81%87"),
      ),
    );
  });
  it("backend errors remain visible", async () => {
    vi.mocked(api).mockRejectedValue(new Error("页面不存在或不在授权范围内"));
    mount(undefined, viewer, "/knowledge/manage/pages/page");
    expect(
      (await screen.findAllByText("页面不存在或不在授权范围内")).length,
    ).toBeGreaterThan(0);
  });
  it("editor flushes latest changes before publishing with returned version", async () => {
    mount(
      <KnowledgeEditor page={page} onClose={vi.fn()} onPublished={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("页面标题"), {
      target: { value: "新标题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发布新版本" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/knowledge/pages/page/publish",
        expect.objectContaining({ body: '{"expectedVersion":5}' }),
      ),
    );
    const patch = vi
      .mocked(api)
      .mock.calls.find(([, i]) => i?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1]?.body))).toEqual({
      title: "新标题",
      expectedVersion: 4,
    });
    expect(page.tags).toEqual(["休假"]);
  });
  it("omits tag/location inputs and places the authorized parent path above the title", () => {
    mount(
      <KnowledgeEditor
        page={{ ...page, parentId: "parent", breadcrumb: [
          { id: "hr", title: "人力资源" },
          { id: "parent", title: "公司制度" },
          { id: page.id, title: page.title },
        ] }}
        onClose={vi.fn()} onPublished={vi.fn()}
      />,
    );
    const path = screen.getByLabelText("页面路径");
    expect(path).toHaveTextContent("人力资源 > 公司制度");
    expect(path.compareDocumentPosition(screen.getByLabelText("页面标题")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText("页面标签")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByLabelText("页面正文").compareDocumentPosition(screen.getByLabelText("页面说明")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });
  it.each([
    { breadcrumb: page.breadcrumb, spaceName: undefined },
    { breadcrumb: [{ id: "hr", title: "人力资源" }], spaceName: undefined },
    { breadcrumb: undefined, spaceName: "人力资源" },
  ])("shows the Space path for a root page without changing metadata: %j", (location) => {
    mount(<KnowledgeEditor page={{ ...page, ...location }} onClose={vi.fn()} onPublished={vi.fn()} />);
    expect(screen.getByLabelText("页面路径")).toHaveTextContent(/^人力资源$/);
    expect(api).not.toHaveBeenCalled();
  });
  it("puts FILE preview first and flushes description before primary upload and publish without clearing tags", async () => {
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.endsWith("/files")) return { attachment: { id: "primary", role: "PRIMARY", originalName: "制度.pdf" }, version: 6 } as never;
      if (!init?.method) return { ...page, version: path.includes("mode=working") ? 6 : 4 } as never;
      return { version: init?.method === "PATCH" ? 5 : 7 } as never;
    });
    const onPublished = vi.fn();
    const view = mount(<KnowledgeEditor page={{ ...page, contentMode: "FILE", primaryFile: { ...page.attachments![0]!, role: "PRIMARY" } }} onClose={vi.fn()} onPublished={onPublished} />);
    expect(screen.queryByLabelText("页面正文")).toBeNull();
    expect(screen.getByText("文件预览").compareDocumentPosition(screen.getByLabelText("页面说明")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(screen.getByLabelText("页面说明"), { target: { value: "修订说明" } });
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["pdf"], "制度.pdf")] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "发布新版本" })).toBeEnabled());
    await waitFor(() => expect(api).toHaveBeenCalledWith("/knowledge/pages/page/files", expect.objectContaining({ body: expect.any(FormData) })));
    const calls = vi.mocked(api).mock.calls;
    expect(JSON.parse(String(calls[0]![1]?.body))).toEqual({ description: "修订说明", expectedVersion: 4 });
    const form = calls[1]![1]?.body as FormData;
    expect(form.get("expectedVersion")).toBe("5");
    expect(form.get("role")).toBe("PRIMARY");
    expect(form.has("tags")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "发布新版本" }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith("/knowledge/pages/page/publish", expect.objectContaining({ body: '{"expectedVersion":6}' }));
    expect(page.tags).toEqual(["休假"]);
  });
  it("409 retains local text and displays conflict rather than overwriting", async () => {
    vi.mocked(api).mockRejectedValue(
      Object.assign(new Error("版本冲突，请保留本地修改"), { status: 409 }),
    );
    mount(
      <KnowledgeEditor page={page} onClose={vi.fn()} onPublished={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("页面标题"), {
      target: { value: "未保存本地文本" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(
      (await screen.findAllByText("版本冲突，请保留本地修改")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("未保存本地文本")).toBeVisible();
    expect(screen.getByRole("button", { name: "发布新版本" })).toBeDisabled();
  });
  it("upload uses pageId before manual save and optimistic version", async () => {
    const view = mount(
      <KnowledgeEditor
        page={{ ...page, status: "DRAFT", version: 1 }}
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    );
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["x"], "new.txt")] },
    });
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/knowledge/pages/page/files",
        expect.objectContaining({ body: expect.any(FormData) }),
      ),
    );
    const call = vi
      .mocked(api)
      .mock.calls.find(([p]) => p.endsWith("/files"))!;
    expect((call[1]?.body as FormData).get("expectedVersion")).toBe("1");
  });
});

it("shows every successful upload in a reopenable results list instead of navigating only to the first", async () => {
  mount();
  fireEvent.mouseOver(await screen.findByRole("button", { name: "新建知识" }));
  fireEvent.click(await screen.findByText("上传文件", { exact: true }));
  await waitFor(() => expect(screen.getByRole("dialog", { name: "上传文件" })).toBeVisible());
  fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(["pdf"], "第一份.pdf"), new File(["pdf"], "第二份.pdf")] } });
  await screen.findByLabelText("知识页面标题：第二份.pdf");
  vi.mocked(uploadKnowledgeFile).mockResolvedValueOnce({ id: "first" }).mockResolvedValueOnce({ id: "second" });
  fireEvent.click(screen.getByRole("button", { name: "上传为草稿 / 重试失败项" }));
  await waitFor(() => expect(screen.getAllByText("草稿已创建")).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: /完\s*成/ }));
  await waitFor(() => expect(screen.getByRole("dialog", { name: "本批次已创建的知识页面" })).toBeVisible());
  expect(screen.getByRole("button", { name: "第一份" })).toBeVisible();
  expect(screen.getByRole("button", { name: "第二份" })).toBeVisible();
  expect(screen.getByRole("button", { name: "查看最近上传结果（2）" })).toBeVisible();
  expect(api).not.toHaveBeenCalledWith("/knowledge/pages/first?mode=working");
});

describe("Knowledge publishing UX", () => {
  it.each(["RICH_TEXT", "FILE"] as const)("publishes a %s draft directly from the reader with a fresh lock and one request", async (contentMode) => {
    const base = vi.mocked(api).getMockImplementation()!;
    let resolve!: (row: KnowledgePage) => void;
    const fresh = new Promise<KnowledgePage>((r) => { resolve = r; });
    const draft = { ...page, status: "DRAFT" as const, contentMode, publishedVersion: undefined, publishedVersionId: null };
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === "/knowledge/pages/page?mode=working") return init?.cache === "no-store" ? fresh as never : draft as never;
      return base(path, init);
    });
    mount(undefined, admin, "/knowledge/manage/pages/page?mode=working");
    const publish = await screen.findByRole("button", { name: "发布" });
    expect(screen.getByRole("button", { name: "编辑" })).toBeVisible();
    expect(screen.queryByLabelText("页面标题")).toBeNull();
    fireEvent.click(publish);
    fireEvent.click(publish);
    expect(api).toHaveBeenCalledWith("/knowledge/pages/page?mode=working", { cache: "no-store" });
    resolve({ ...draft, version: 11 });
    await waitFor(() => expect(api).toHaveBeenCalledWith("/knowledge/pages/page/publish", expect.objectContaining({ method: "POST", body: '{"expectedVersion":11}' })));
    expect(vi.mocked(api).mock.calls.filter(([p]) => p.endsWith("/publish"))).toHaveLength(1);
    expect(vi.mocked(api).mock.calls.some(([,i]) => i?.method === "PATCH")).toBe(false);
    await screen.findByText("页面已发布");
    await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([p]) => p.includes("/tree")).length).toBeGreaterThan(1));
  });
  it("does not promote repeated publication or claim a draft exists on unchanged published pages", async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (p,i) => p.startsWith("/knowledge/pages/page?") ? { ...page, hasUnpublishedChanges: false } as never : base(p,i));
    mount(undefined, admin, "/knowledge/manage/pages/page");
    await screen.findByRole("button", { name: "编辑" });
    expect(screen.queryByRole("button", { name: "发布新版本" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await screen.findByLabelText("页面标题");
    expect(screen.queryByRole("button", { name: "发布新版本" })).toBeNull();
    expect(screen.queryByText(/存在工作草稿|有未发布修改/)).toBeNull();
    fireEvent.change(screen.getByLabelText("页面标题"), { target: { value: "标题单独修改" } });
    expect(screen.getByRole("button", { name: "发布新版本" })).toBeVisible();
  });
  it("labels a published page from its readable status even when version metadata is hidden", async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (p,i) => p.startsWith("/knowledge/pages/page?") ? { ...page, publishedVersionId: undefined, publishedVersion: undefined } as never : base(p,i));
    mount(undefined, admin, "/knowledge/manage/pages/page");
    expect(await screen.findByRole("button", { name: "发布新版本" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "发布" })).toBeNull();
  });
  it("keeps save/publish together above the title and body in a sticky toolbar", () => {
    mount(<KnowledgeEditor page={page} onClose={vi.fn()} onPublished={vi.fn()} />);
    const toolbar = screen.getByRole("toolbar", { name: "页面编辑操作" });
    expect(toolbar).toHaveClass("knowledge-editor-actions");
    expect(toolbar.contains(screen.getByRole("button", { name: "保存" }))).toBe(true);
    expect(toolbar.contains(screen.getByRole("button", { name: "发布新版本" }))).toBe(true);
    expect(toolbar.compareDocumentPosition(screen.getByLabelText("页面标题")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it.each(["field", "page", "history"])("hides reader publication for missing %s authority or historical reading", async (condition) => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (p,i) => p.startsWith("/knowledge/pages/page?") ? { ...page, canEdit: condition !== "page" } as never : base(p,i));
    const user = condition === "field" ? { sub: "editor", permissions: [...viewer.permissions, "knowledge-pages:*:update", "knowledge-pages:title:update"] } : admin;
    mount(undefined, user, `/knowledge/manage/pages/page${condition === "history" ? "?versionId=v1" : ""}`);
    await screen.findByText("制度正文");
    expect(screen.queryByRole("button", { name: "发布新版本" })).toBeNull();
    if (condition === "page") expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
  });
  it.each(["最新草稿读取失败", "请先发布上级页面，再发布子页面", "数据已发生变化，请刷新后重试"])("displays publication failure: %s without success", async (reason) => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (p,i) => {
      if (i?.cache === "no-store" && reason === "最新草稿读取失败") throw new Error(reason);
      if (p.endsWith("/publish")) throw Object.assign(new Error(reason), { status: reason.includes("数据") ? 409 : 400 });
      return base(p,i);
    });
    mount(undefined, admin, "/knowledge/manage/pages/page");
    fireEvent.click(await screen.findByRole("button", { name: "发布新版本" }));
    await waitFor(() => expect(screen.getAllByText(reason).length).toBeGreaterThan(0));
    expect(screen.queryByText("页面已发布")).toBeNull();
    expect(screen.getByRole("button", { name: "发布新版本" })).toBeEnabled();
  });
  it.each(["unchanged", "revoked", "unknown"])("rechecks latest %s state before issuing a publish command", async (state) => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (p,i) => i?.cache === "no-store" ? { ...page, hasUnpublishedChanges: state === "unknown" ? undefined : state !== "unchanged", canEdit: state !== "revoked" } as never : base(p,i));
    mount(undefined, admin, "/knowledge/manage/pages/page");
    fireEvent.click(await screen.findByRole("button", { name: "发布新版本" }));
    await screen.findAllByText(state === "unchanged" ? "没有未发布修改" : state === "unknown" ? "无法确认最新草稿的发布状态，请刷新后重试" : "当前没有此页面的发布权限");
    expect(vi.mocked(api).mock.calls.some(([p]) => p.endsWith("/publish"))).toBe(false);
    expect(screen.queryByText("页面已发布")).toBeNull();
  });
  it("does not adopt another writer's version after draining editor autosave", async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (p,i) => i?.cache === "no-store" ? { ...page, version: 12 } as never : base(p,i));
    const onPublished = vi.fn();
    mount(<KnowledgeEditor page={page} onClose={vi.fn()} onPublished={onPublished} />);
    fireEvent.change(screen.getByLabelText("页面标题"), { target: { value: "本地标题" } });
    fireEvent.click(screen.getByRole("button", { name: "发布新版本" }));
    await screen.findAllByText("页面已被其他用户修改，请保留本地修改并重新加载");
    expect(screen.getByLabelText("页面标题")).toHaveValue("本地标题");
    expect(screen.getByRole("button", { name: "发布新版本" })).toBeDisabled();
    expect(vi.mocked(api).mock.calls.some(([p]) => p.endsWith("/publish"))).toBe(false);
    expect(onPublished).not.toHaveBeenCalled();
  });
  it("removes publication prompt after a saved edit restores exactly the published data", async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (p,i) => i?.cache === "no-store" ? { ...page, version: 5, hasUnpublishedChanges: false } as never : base(p,i));
    mount(<KnowledgeEditor page={page} onClose={vi.fn()} onPublished={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("页面标题"), { target: { value: "临时改名" } });
    fireEvent.change(screen.getByLabelText("页面标题"), { target: { value: page.title } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/knowledge/pages/page?mode=working", expect.objectContaining({ cache: "no-store" })));
    await waitFor(() => expect(screen.queryByRole("button", { name: "发布新版本" })).toBeNull());
    expect(screen.queryByText(/有未发布修改/)).toBeNull();
  });
});
