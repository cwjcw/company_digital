import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "antd";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { api } from "../../api";
import { downloadApiFile } from "../../shared/legacy-ui";
import { KnowledgeFilePreview } from "./KnowledgeFilePreview";
const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: pdf.getDocument,
}));
vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("../../shared/legacy-ui", () => ({
  downloadApiFile: vi.fn().mockResolvedValue(undefined),
}));
const file = {
  id: "file",
  pageId: "page",
  sha256: "f".repeat(64),
  createdAt: "2026-10-09T00:00:00Z",
  originalName: "制度.docx",
  contentType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size: 20,
  role: "PRIMARY" as const,
};
const mount = (props = {}) =>
  render(
    <App>
      <KnowledgeFilePreview
        file={file}
        scope={{ mode: "published", versionId: "v1" }}
        canRetry
        {...props}
      />
    </App>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as any,
  );
  pdf.getPage.mockResolvedValue({
    getViewport: () => ({ width: 100, height: 100 }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  });
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 3, getPage: pdf.getPage }),
    destroy: pdf.destroy,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("file reader", () => {
  it("opens version-bound PDF using header authentication and supports page navigation", async () => {
    localStorage.setItem("accessToken", "runtime-fixture");
    vi.mocked(api).mockResolvedValue({
      status: "SUCCEEDED",
      native: false,
      contentType: file.contentType,
    });
    mount();
    await screen.findByText("/ 3");
    expect(pdf.getDocument.mock.calls[0]![0]).toMatchObject({
      url: "/api/v1/knowledge/files/file/preview?mode=published&versionId=v1",
      httpHeaders: { Authorization: "Bearer runtime-fixture" },
      disableStream: true,
      disableAutoFetch: true,
      rangeChunkSize: 65536,
    });
    fireEvent.click(screen.getByText("下一页"));
    await waitFor(() => expect(pdf.getPage).toHaveBeenCalledWith(2));
    fireEvent.click(screen.getByText("下载原文件"));
    expect(downloadApiFile).toHaveBeenCalledWith(
      "/knowledge/files/file/original?mode=published&versionId=v1",
      "制度.docx",
    );
  });
  it("keeps processing explicit instead of claiming a preview is ready", async () => {
    vi.mocked(api).mockResolvedValue({
      status: "RUNNING",
      native: false,
      contentType: file.contentType,
    });
    mount();
    await screen.findByText("文件已上传，在线预览正在生成");
    expect(pdf.getDocument).not.toHaveBeenCalled();
  });
  it("shows conversion failure and retries through the same version-bound API", async () => {
    vi.mocked(api).mockImplementation(async (path) =>
      String(path).includes("retry-preview")
        ? {}
        : {
            status: "FAILED",
            error: "转换超时",
            native: false,
            contentType: file.contentType,
          },
    );
    mount();
    await screen.findByText("在线预览生成失败：转换超时");
    fireEvent.click(screen.getByText("重试转换"));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/knowledge/files/file/retry-preview?mode=published&versionId=v1",
        { method: "POST" },
      ),
    );
  });
  it("hides administrator retry for a reader and warns about Excel print boundaries", async () => {
    vi.mocked(api).mockResolvedValue({
      status: "FAILED",
      error: "损坏",
      native: false,
      contentType: file.contentType,
    });
    mount({ canRetry: false, file: { ...file, originalName: "计划.xlsx" } });
    await screen.findByText("在线预览生成失败：损坏");
    expect(screen.queryByText("重试转换")).toBeNull();
    expect(screen.getByText(/Excel预览按工作簿打印区域分页/)).toBeTruthy();
  });
  it("never starts PDF transport when status authorization is denied", async () => {
    vi.mocked(api).mockRejectedValue(new Error("无权限"));
    mount();
    await screen.findByText("在线预览失败：无权限");
    expect(pdf.getDocument).not.toHaveBeenCalled();
  });
});
