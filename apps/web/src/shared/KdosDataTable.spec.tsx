import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { KdosDataTable } from "./KdosDataTable";

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

    await waitFor(() => expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50 })));
    onQueryChange.mockClear();
    fireEvent.click(view.container.querySelector(".ant-pagination-item-2")!);

    await waitFor(() => expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 50 })));
    expect(view.container.querySelector(".ant-pagination-item-2")).toHaveClass("ant-pagination-item-active");
  });
});
