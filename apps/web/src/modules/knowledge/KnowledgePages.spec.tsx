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
import { KnowledgeWiki } from "./KnowledgePages";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { ModulePortal } from "../portal/ModulePortal";
vi.mock("./knowledge-file-upload", () => ({ uploadKnowledgeFile: vi.fn() }));
vi.mock("./KnowledgeFilePreview",()=>({KnowledgeFilePreview:()=> <div>文件预览</div>}));
vi.mock("../../api", () => ({ api: vi.fn() }));
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
  element: React.ReactNode = <KnowledgeWiki />,
  session: any = admin,
  path = "/knowledge",
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
            <Route path="/knowledge/pages/:id" element={element} />
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
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (init?.method) {
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
        : (page as never);
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
    mount(undefined, admin, "/knowledge/pages/page?edit=1", client);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/knowledge/pages/page?mode=working"),
    );
    expect(screen.queryByLabelText("页面标题")).toBeNull();
    release({ ...page, version: 9 });
    const title = await screen.findByLabelText("页面标题");
    fireEvent.change(title, { target: { value: "最新工作副本" } });
    fireEvent.click(screen.getByRole("button", { name: "立即保存" }));
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
    mount(undefined, viewer, "/knowledge/pages/page");
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
    mount(undefined, viewer, "/knowledge/pages/page");
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
    mount(undefined, viewer, "/knowledge/pages/page");
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
    expect(api).toHaveBeenLastCalledWith("/knowledge/pages/page/publish", expect.objectContaining({ body: '{"expectedVersion":6}' }));
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
    fireEvent.click(screen.getByRole("button", { name: "立即保存" }));
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
