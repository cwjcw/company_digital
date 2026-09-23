import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { KdosDataTable } from "./KdosDataTable";

afterEach(() => cleanup());

vi.mock("../api", () => ({ api: vi.fn() }));

describe("KdosDataTable server pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(api).mockResolvedValue([] as never);
  });

  it("keeps the requested page instead of resetting a pagination action to page one", async () => {
    const onQueryChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}>
      <KdosDataTable
        resource="equipment-register"
        rowKey="id"
        columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]}
        dataSource={[{ id: "asset-1", equipmentCode: "A001" }]}
        serverData={{ total: 120, onQueryChange }}
      />
    </QueryClientProvider>);

    await waitFor(() => expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 100 })));
    onQueryChange.mockClear();
    fireEvent.click(view.container.querySelector(".ant-pagination-item-2")!);

    await waitFor(() => expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 100 })));
    expect(view.container.querySelector(".ant-pagination-item-2")).toHaveClass("ant-pagination-item-active");
  });

  it("keeps an explicit page size instead of replacing it with the platform default", async () => {
    const onQueryChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id"
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[]} serverData={{ total: 0, onQueryChange }}
      pagination={{ pageSize: 50 }} /></QueryClientProvider>);
    await waitFor(() => expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50 })));
  });

  it("simple 汇总表不显示搜索、高级筛选、字段显示或列菜单", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><KdosDataTable simple resource="equipment-register" systemFields={false}
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[{ id: "1", equipmentCode: "A001" }]} /></QueryClientProvider>);
    expect(screen.queryByRole("button", { name: "设备编号列菜单" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("搜索当前表格")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /字段显示/ })).not.toBeInTheDocument();
  });

  it("allows stable record selection in browse mode and clears it explicitly", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "viewer", permissions: ["mps-group-plans:*:read"] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}>
      <KdosDataTable resource="mps-group-plans" rowKey="id" columns={[{ title: "订单编号", dataIndex: "orderNumber" }]}
        dataSource={[{ id: "stable-a", orderNumber: "A" }, { id: "stable-b", orderNumber: "B" }]} serverData={{ total: 12, onQueryChange: vi.fn() }} />
    </QueryClientProvider>);

    const rowCheckboxes = view.container.querySelectorAll("tbody tr input[type=checkbox]");
    expect(rowCheckboxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(rowCheckboxes[rowCheckboxes.length - 1]!);
    expect(await view.findByText("已选 1/12")).toBeInTheDocument();
    expect(view.container.querySelector("section")?.getAttribute("data-edit-mode")).toBe("readonly");
    fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
    await waitFor(() => expect(screen.queryByText("已选 1/12")).not.toBeInTheDocument());
  });

  it("selects only the current page and preserves explicit selections across pages", async () => {
    const onQueryChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = { resource: "mps-group-plans", rowKey: "id" as const, columns: [{ title: "订单编号", dataIndex: "orderNumber" }], serverData: { total: 120, onQueryChange } };
    const view = render(<QueryClientProvider client={client}><KdosDataTable {...props}
      dataSource={[{ id: "page-1-a", orderNumber: "A" }, { id: "page-1-b", orderNumber: "B" }]} /></QueryClientProvider>);

    const firstPageCheckboxes = view.container.querySelectorAll("tbody tr input[type=checkbox]");
    fireEvent.click(firstPageCheckboxes[firstPageCheckboxes.length - 2]!);
    fireEvent.click(firstPageCheckboxes[firstPageCheckboxes.length - 1]!);
    expect(await view.findByText("已选 2/120")).toBeInTheDocument();
    fireEvent.click(view.container.querySelector(".ant-pagination-item-2")!);
    view.rerender(<QueryClientProvider client={client}><KdosDataTable {...props}
      dataSource={[{ id: "page-2-a", orderNumber: "C" }, { id: "page-2-b", orderNumber: "D" }]} /></QueryClientProvider>);
    const secondPageCheckboxes = view.container.querySelectorAll("tbody tr input[type=checkbox]");
    fireEvent.click(secondPageCheckboxes[secondPageCheckboxes.length - 1]!);
    expect(await view.findByText("已选 3/120")).toBeInTheDocument();
    expect(Array.from(secondPageCheckboxes).filter((node) => (node as HTMLInputElement).checked)).toHaveLength(1);
  });
});
