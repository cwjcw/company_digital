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
import { api } from "../../api";
vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("./knowledge-file-upload", () => ({ uploadKnowledgeFile: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (path) => path.includes("/locations") ? {
    rows: [{ id: "policy", title: "公司制度", parentId: null, breadcrumb: [{ id: "hr", title: "人力资源" }, { id: "policy", title: "公司制度" }] }], total: 1,
  } as never : { maxFileBytes: 100 * 1024 * 1024, maxBatchFiles: 20 } as never);
});
afterEach(cleanup);
it("batch retains successful drafts, isolates failures and retries only failed files with their original key", async () => {
  const created = vi.fn();
  vi.mocked(uploadKnowledgeFile).mockImplementation(
    async (file, _input, onProgress) => {
      onProgress(100);
      if (file.name === "损坏.pdf") throw new Error("文件格式损坏");
      return { id: "draft-one" };
    },
  );
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App>
      <KnowledgeFileUpload
        spaces={[{ id: "hr", name: "人力资源", canCreate: true } as any]}
        spaceId="hr"
        parentId="policy"
        onCreated={created}
        onClose={vi.fn()}
      />
    </App></QueryClientProvider>,
  );
  const input =
    view.container.parentElement?.querySelector("input[type=file]") ??
    document.querySelector("input[type=file]");
  expect(input).toBeTruthy();
  fireEvent.change(input!, {
    target: {
      files: [
        new File(["pdf"], "正常.pdf", { type: "application/pdf" }),
        new File(["bad"], "损坏.pdf", { type: "application/pdf" }),
      ],
    },
  });
  await screen.findByText("正常.pdf");
  await waitFor(() => expect(screen.getByText("上传为草稿 / 重试失败项").closest("button")).toBeEnabled());
  fireEvent.click(screen.getByText("上传为草稿 / 重试失败项"));
  await screen.findByText("文件格式损坏");
  expect(uploadKnowledgeFile).toHaveBeenCalledTimes(2);
  const key = vi.mocked(uploadKnowledgeFile).mock.calls[1]![1];
  vi.mocked(uploadKnowledgeFile).mockResolvedValueOnce({ id: "draft-two" });
  fireEvent.click(screen.getByText("上传为草稿 / 重试失败项"));
  await waitFor(() => expect(uploadKnowledgeFile).toHaveBeenCalledTimes(3));
  expect(vi.mocked(uploadKnowledgeFile).mock.calls[2]![1]).toEqual(key);
  await waitFor(() =>
    expect(screen.getAllByText(/草稿已创建/)).toHaveLength(2),
  );
  fireEvent.click(screen.getByRole("button", { name: /完\s*成/ }));
  expect(created).toHaveBeenCalledWith(["draft-one", "draft-two"]);
});
