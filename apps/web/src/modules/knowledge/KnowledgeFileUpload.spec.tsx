import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { KnowledgeFileUpload } from "./KnowledgeFileUpload";
import { uploadKnowledgeFile } from "./knowledge-file-upload";
import { api, ApiError } from "../../api";
vi.mock("../../api", async (original) => ({
  ...(await original<object>()),
  api: vi.fn(),
}));
vi.mock("./knowledge-file-upload", () => ({ uploadKnowledgeFile: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("/locations")
      ? ({
          rows: [
            {
              id: "policy",
              title: "公司制度",
              parentId: null,
              breadcrumb: [
                { id: "hr", title: "人力资源" },
                { id: "policy", title: "公司制度" },
              ],
            },
          ],
          total: 1,
        } as never)
      : ({ maxFileBytes: 100 * 1024 * 1024, maxBatchFiles: 20 } as never),
  );
});
afterEach(cleanup);
function mount(parentId?: string) {
  const created = vi.fn(),
    closed = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App>
        <KnowledgeFileUpload
          spaces={[{ id: "hr", name: "人力资源", canCreate: true } as any]}
          spaceId="hr"
          parentId={parentId}
          onCreated={created}
          onClose={closed}
        />
      </App>
    </QueryClientProvider>,
  );
  return { created, closed };
}
async function choose(...names: string[]) {
  fireEvent.change(document.querySelector("input[type=file]")!, {
    target: {
      files: names.map(
        (name) => new File(["pdf"], name, { type: "application/pdf" }),
      ),
    },
  });
  await screen.findByText(names[0]!);
}
async function run() {
  const button = screen.getByRole("button", {
    name: "上传为草稿 / 重试失败项",
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}
it("defaults titles without extension, supports distinct Chinese titles and removes only unsubmitted files", async () => {
  const { created } = mount();
  await choose("默认标题.pdf", "第二份.docx", "移除.pdf");
  expect(screen.getByLabelText("知识页面标题：默认标题.pdf")).toHaveValue(
    "默认标题",
  );
  fireEvent.change(screen.getByLabelText("知识页面标题：第二份.docx"), {
    target: { value: "自定义中文标题" },
  });
  fireEvent.click(screen.getAllByRole("button", { name: /移\s*除/ })[2]!);
  expect(screen.queryByText("移除.pdf")).toBeNull();
  vi.mocked(uploadKnowledgeFile)
    .mockResolvedValueOnce({ id: "first" })
    .mockResolvedValueOnce({ id: "second" });
  await run();
  await waitFor(() =>
    expect(screen.getAllByText("草稿已创建")).toHaveLength(2),
  );
  expect(
    vi.mocked(uploadKnowledgeFile).mock.calls.map((call) => call[1].title),
  ).toEqual(["默认标题", "自定义中文标题"]);
  expect(screen.queryByRole("button", { name: /移\s*除/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /完\s*成/ }));
  expect(created).toHaveBeenCalledWith([
    { id: "first", title: "默认标题" },
    { id: "second", title: "自定义中文标题" },
  ]);
});
it("keeps successful drafts, reports partial failure and asks whether to retry or leave", async () => {
  const { created } = mount("policy");
  await choose("正常.pdf", "损坏.pdf");
  vi.mocked(uploadKnowledgeFile)
    .mockResolvedValueOnce({ id: "one" })
    .mockRejectedValueOnce(new ApiError("文件格式损坏", 400));
  await run();
  await screen.findByText("文件格式损坏");
  expect(screen.getByRole("status")).toHaveTextContent("成功 1 个，失败 1 个");
  fireEvent.click(screen.getByRole("button", { name: /完\s*成/ }));
  expect(created).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", { name: "继续上传 / 重试" }),
  );
  vi.mocked(uploadKnowledgeFile).mockResolvedValueOnce({ id: "two" });
  await run();
  await waitFor(() =>
    expect(screen.getAllByText("草稿已创建")).toHaveLength(2),
  );
  expect(uploadKnowledgeFile).toHaveBeenCalledTimes(3);
  expect(vi.mocked(uploadKnowledgeFile).mock.calls[2]![1]).toEqual(
    vi.mocked(uploadKnowledgeFile).mock.calls[1]![1],
  );
  fireEvent.click(screen.getByRole("button", { name: /完\s*成/ }));
  expect(created.mock.calls[0]![0]).toHaveLength(2);
});
it("confirming departure returns successful pages and retains their drafts despite a failed sibling", async () => {
  const { created } = mount();
  await choose("正常.pdf", "失败.pdf");
  vi.mocked(uploadKnowledgeFile)
    .mockResolvedValueOnce({ id: "safe" })
    .mockRejectedValueOnce(new ApiError("暂时失败", 503));
  await run();
  await screen.findByText("暂时失败");
  fireEvent.click(screen.getByRole("button", { name: /完\s*成/ }));
  fireEvent.click(await screen.findByRole("button", { name: "确认离开" }));
  expect(created).toHaveBeenCalledWith([{ id: "safe", title: "正常" }]);
});
it("locks active files and synchronously prevents double-clicks creating duplicate pages", async () => {
  mount();
  await choose("执行中.pdf");
  let resolve!: (value: { id: string }) => void;
  vi.mocked(uploadKnowledgeFile).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const submit = screen.getByRole("button", {
    name: "上传为草稿 / 重试失败项",
  });
  await run();
  fireEvent.click(submit);
  await waitFor(() => expect(uploadKnowledgeFile).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("知识页面标题：执行中.pdf")).toBeDisabled();
  expect(screen.getByRole("button", { name: "更改位置" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: /移\s*除/ })).toBeNull();
  resolve({ id: "once" });
  await screen.findByText("草稿已创建");
});
it("retries a lost response after server creation with identical file/title/location/key and creates exactly one page", async () => {
  mount("policy");
  await choose("原文件.pdf");
  fireEvent.change(screen.getByLabelText("知识页面标题：原文件.pdf"), {
    target: { value: "合同中文标题" },
  });
  const persisted = new Map<string, string>();
  vi.mocked(uploadKnowledgeFile).mockImplementation(async (_file, input) => {
    const existing = persisted.get(input.idempotencyKey);
    if (existing) return { id: existing };
    persisted.set(input.idempotencyKey, "already-created");
    throw new ApiError("上传超时", 0);
  });
  await run();
  await screen.findByText("上传超时");
  expect(screen.getByLabelText("知识页面标题：原文件.pdf")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "重新发起上传" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "更改位置" }));
  fireEvent.click(screen.getByRole("button", { name: "空间根目录" }));
  await run();
  await screen.findByText("草稿已创建");
  const calls = vi.mocked(uploadKnowledgeFile).mock.calls;
  expect(calls[1]![0]).toBe(calls[0]![0]);
  expect(calls[1]![1]).toEqual(calls[0]![1]);
  expect(calls[1]![1]).toMatchObject({
    title: "合同中文标题",
    spaceId: "hr",
    parentId: "policy",
  });
  expect(persisted.size).toBe(1);
});
it("permits changing a definitively rejected request only through an explicit new upload with a new key", async () => {
  mount("policy");
  await choose("可改标题.pdf");
  vi.mocked(uploadKnowledgeFile).mockRejectedValueOnce(
    new ApiError("标题无效", 400),
  );
  await run();
  await screen.findByText("标题无效");
  const old = vi.mocked(uploadKnowledgeFile).mock.calls[0]![1];
  fireEvent.click(screen.getByRole("button", { name: "重新发起上传" }));
  fireEvent.change(screen.getByLabelText("知识页面标题：可改标题.pdf"), {
    target: { value: "重新提交的标题" },
  });
  fireEvent.click(screen.getByRole("button", { name: "更改位置" }));
  fireEvent.click(screen.getByRole("button", { name: "空间根目录" }));
  vi.mocked(uploadKnowledgeFile).mockResolvedValueOnce({ id: "new-page" });
  await run();
  await screen.findByText("草稿已创建");
  const fresh = vi.mocked(uploadKnowledgeFile).mock.calls[1]![1];
  expect(fresh.idempotencyKey).not.toBe(old.idempotencyKey);
  expect(fresh.title).toBe("重新提交的标题");
  expect(fresh.parentId).toBeUndefined();
});
it("keeps an unknown outcome locked even if a subsequent retry is rejected", async () => {
  mount();
  await choose("未知.pdf");
  vi.mocked(uploadKnowledgeFile)
    .mockRejectedValueOnce(new ApiError("网络失败", 0))
    .mockRejectedValueOnce(new ApiError("权限变更", 403));
  await run();
  await screen.findByText("网络失败");
  await run();
  await screen.findByText("权限变更");
  expect(screen.queryByRole("button", { name: "重新发起上传" })).toBeNull();
  expect(screen.getByLabelText("知识页面标题：未知.pdf")).toBeDisabled();
});
it("rejects empty titles before submitting and warns before discarding unsubmitted files", async () => {
  const { closed } = mount();
  await choose("必填.pdf");
  fireEvent.change(screen.getByLabelText("知识页面标题：必填.pdf"), {
    target: { value: " " },
  });
  await run();
  await screen.findByText("知识页面标题不能为空，且最多300个字符");
  expect(uploadKnowledgeFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /完\s*成/ }));
  const leave = await screen.findByRole("button", { name: "确认离开" });
  expect(closed).not.toHaveBeenCalled();
  fireEvent.click(leave);
  expect(closed).toHaveBeenCalledOnce();
});
