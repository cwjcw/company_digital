import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { KnowledgeSpace } from "@kdos/contracts";
import { KnowledgeImport } from "./KnowledgeImport";
import { api } from "../../api";
vi.mock("../../api", () => ({ api: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (path) => path.endsWith("preview") ? {
    token: "fixture-import-preview", title: "导入制度", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "DOCX正文" }] }] }, warnings: [], images: [],
  } as never : { id: "imported" } as never);
});
afterEach(cleanup);
it("imports DOCX through the existing preview/commit flow at the selected root without tag UI", async () => {
  const created = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App><KnowledgeImport spaces={[{ id: "hr", name: "人力资源", canCreate: true } as KnowledgeSpace]} spaceId="hr" onCreated={created} onClose={vi.fn()} /></App></QueryClientProvider>);
  expect(screen.getByLabelText("保存位置")).toHaveTextContent("空间根目录");
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByLabelText("导入页面标签")).toBeNull();
  fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(["fixture"], "制度.docx")] } });
  await waitFor(() => expect(screen.getByText("DOCX正文")).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "导入为草稿" }));
  await waitFor(() => expect(created).toHaveBeenCalledWith("imported"));
  expect(api).toHaveBeenLastCalledWith("/knowledge/imports/commit", expect.objectContaining({ body: JSON.stringify({ token: "fixture-import-preview", title: "导入制度", spaceId: "hr", parentId: null }) }));
});

it("preserves nested DOCX image positions as explicit safe placeholders without image fetches", async () => {
  const base = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, init) => {
    const result: any = await base(path, init);
    return path.endsWith("preview") ? { ...result, images: [{ tempId: "embedded" }], content: { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "图片前" }] },
      { type: "callout", content: [{ type: "attachmentImage", attrs: { attachmentId: "temp-image", alt: "制度流程图", src: "https://unsafe.example/image.png" } }] },
      { type: "paragraph", content: [{ type: "text", text: "图片后" }] },
    ] } } : result;
  });
  render(<QueryClientProvider client={new QueryClient()}><App><KnowledgeImport spaces={[{ id: "hr", name: "人力资源", canCreate: true } as KnowledgeSpace]} spaceId="hr" onCreated={vi.fn()} onClose={vi.fn()} /></App></QueryClientProvider>);
  fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(["fixture"], "有图制度.docx")] } });
  const placeholder = await screen.findByRole("note");
  expect(placeholder).toHaveTextContent("制度流程图（正式导入后可查看");
  expect(screen.getByText("图片前").compareDocumentPosition(placeholder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(placeholder.compareDocumentPosition(screen.getByText("图片后")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelector('img')).toBeNull();
  expect(api).not.toHaveBeenCalledWith(expect.stringContaining("/files/"), expect.anything());
});
