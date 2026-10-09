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
