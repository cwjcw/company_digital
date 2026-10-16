import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { MasterPlanOrderProgress } from "./MasterPlanOrderProgress";
vi.mock("../../api", () => ({ api: vi.fn(async (url: string) => url.includes("/meta") ? { visibleFields: tablePermissionFieldsFor("mps-order-progress-dashboard").map(f => f.key), canExport: false } : url.includes("/candidates") ? { options: [], hasMore: false } : { rows: [{ id: "synthetic-order", orderNumber: "ORDER" }], total: 2, page: 1, pageSize: 100 }) }));
vi.mock("../../shared/KdosDataTable", async original => ({
  ...await original<typeof import("../../shared/KdosDataTable")>(),
  KdosDataTable: ({ viewKey, serverData, expandable, dataSource }: any) => viewKey === "orders" ? <>
    <button disabled={!dataSource[0]} onClick={() => expandable.onExpandedRowsChange([dataSource[0]?.id])}>展开订单</button>
    <button onClick={() => serverData.onQueryChange({ page: 1, pageSize: 100 })}>初始化查询</button>
    <button onClick={() => serverData.onQueryChange({ page: 2, pageSize: 100 })}>实际翻页</button>
    {dataSource[0] && expandable.expandedRowKeys.includes(dataSource[0].id) && expandable.expandedRowRender(dataSource[0])}
  </> : <div>子表已展开</div>
}));
let client: QueryClient;
afterEach(() => { cleanup(); client?.clear(); localStorage.clear(); });
describe("accepted order matrix initialization", () => {
  it("retains expanded items for an unchanged initial query and collapses them for a real page change", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ permissions: ["*"], isSystemAdmin: true })); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MasterPlanOrderProgress /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "展开订单" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "展开订单" })); await screen.findByText("子表已展开");
    fireEvent.click(screen.getByRole("button", { name: "初始化查询" })); expect(screen.getByText("子表已展开")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "实际翻页" })); expect(screen.queryByText("子表已展开")).not.toBeInTheDocument();
  });
});
