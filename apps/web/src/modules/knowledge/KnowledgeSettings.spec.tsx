import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KnowledgeSettings } from "./KnowledgeSettings";
import { api } from "../../api";
vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("../../shared/KdosDataTable", async (original) => ({
  ...(await original<object>()),
  KdosDataTable: ({ toolbar, dataSource, columns }: any) => <div>{toolbar}{dataSource?.map((row: any) => <div key={row.id}>{columns[0].render(row.name, row)}</div>)}</div>,
}));
const existing = { id: "hr", code: "HR", name: "人力资源", description: "原说明", icon: "book", sortOrder: 0, version: 3, canManage: true };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.setItem("sessionUser", JSON.stringify({ isSystemAdmin: true, permissions: ["*"] }));
  vi.mocked(api).mockImplementation(async (path, init) => init?.method ? { id: "new", version: 1 } as never : path.includes("includeArchived") ? [existing] as never : { rows: [existing], total: 1 } as never);
});
afterEach(() => { cleanup(); localStorage.clear(); });
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><App><KnowledgeSettings /></App></QueryClientProvider>);
}
it("creates using only a name, visual default icon and no client code or required order", async () => {
  mount(); fireEvent.click(await screen.findByRole("button", { name: "新建空间" }));
  expect(screen.queryByLabelText("编码")).toBeNull();
  expect(screen.getByRole("button", { name: "书本" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(screen.getByLabelText("空间名称"), { target: { value: "培训资料" } });
  fireEvent.click(screen.getByRole("button", { name: "研发" }));
  expect(screen.getByLabelText("图标预览")).toHaveTextContent("研发");
  fireEvent.click(screen.getByRole("button", { name: /OK|确\s*定/ }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/knowledge/spaces", expect.objectContaining({ method: "POST" })));
  const call = vi.mocked(api).mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ name: "培训资料", description: "", icon: "research" });
});
it("loads the existing icon and preserves the original code while updating description", async () => {
  mount(); fireEvent.click(await screen.findByRole("button", { name: /^编\s*辑$/ }));
  expect(screen.getByRole("button", { name: "书本" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(screen.getByLabelText("空间说明"), { target: { value: "新说明" } });
  fireEvent.click(screen.getByRole("button", { name: /OK|确\s*定/ }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/knowledge/spaces/hr", expect.objectContaining({ method: "PATCH" })));
  const call = vi.mocked(api).mock.calls.find(([, init]) => init?.method === "PATCH")!;
  const body = JSON.parse(String(call[1]?.body));
  expect(body).toMatchObject({ icon: "book", description: "新说明", expectedVersion: 3 });
  expect(body).not.toHaveProperty("code"); expect(existing.code).toBe("HR");
});
