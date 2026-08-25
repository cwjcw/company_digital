import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { BusinessCustomerMappingsPage, OrderSchedulePage } from "./MarketingPages";

vi.mock("../../api", () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {}
}));

afterEach(() => cleanup());

const schedule = {
  id: "schedule-1", customerCode: "DEMO-C001", orderNumber: "DEMO-SO-001", itemNumber: "DEMO-P001",
  itemName: "演示品项", customerDueDate: "2026-08-28", orderTotalQuantity: "100.0000", productionUnit: "演示一厂",
  completionRatio: "25.0000", sourcePlanItemId: "plan-item-1", version: 3
};

describe("OrderSchedulePage editing", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith("/marketing/order-schedules?") && !init?.method) return [schedule] as never;
      if (path === "/marketing/order-schedules/schedule-1" && init?.method === "PATCH") return { ...schedule, version: 4 } as never;
      throw new Error(`unexpected API call: ${path}`);
    });
  });

  it("edits the selected schedule while preserving its planning source", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><OrderSchedulePage /></QueryClientProvider>);

    expect(await screen.findByText("DEMO-SO-001")).toBeInTheDocument();
    expect(screen.getByText("8月28日")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(screen.getByRole("button", { name: "编辑所选" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑订单排期" });
    const itemName = within(dialog).getByLabelText("品项名称");
    expect(within(dialog).getByLabelText("客户交期")).toHaveValue("8月28日");
    fireEvent.change(itemName, { target: { value: "演示品项（已调整）" } });
    fireEvent.click(screen.getByRole("button", { name: /OK|确 定/ }));

    await waitFor(() => expect(api).toHaveBeenCalledWith("/marketing/order-schedules/schedule-1", expect.objectContaining({ method: "PATCH" })));
    const updateCall = vi.mocked(api).mock.calls.find(([path]) => path === "/marketing/order-schedules/schedule-1");
    expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({ itemName: "演示品项（已调整）", sourcePlanItemId: "plan-item-1", expectedVersion: 3 });
  });
});

describe("BusinessCustomerMappingsPage", () => {
  beforeEach(() => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["business-customer-mapping:*:update"] }));
    vi.mocked(api).mockReset();
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith("/marketing/business-customer-mappings?")) return [{
        id: "mapping-1", department: "欧美业务一部", section: "一课", customerCode: "A001",
        salespersonUserIds: ["00000000-0000-7000-8000-000000000003"], salespersonNames: ["张三"],
        salespersonUsers: [{ id: "00000000-0000-7000-8000-000000000003", displayName: "张三", departmentPaths: [], enabled: true }],
        createdBy: "user-1", createdAt: "2026-08-25T00:00:00Z", updatedBy: "user-1", updatedAt: "2026-08-25T00:00:00Z", version: 1
      }] as never;
      if (path === "/marketing/directory-users") return [{ id: "00000000-0000-7000-8000-000000000003", displayName: "张三", departmentPaths: [], enabled: true }] as never;
      throw new Error(`unexpected API call: ${path}`);
    });
  });

  it("uses customer granularity and the required business-field order", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><BusinessCustomerMappingsPage /></QueryClientProvider>);

    expect(await screen.findByRole("heading", { name: "业务人员与客户对应表" })).toBeInTheDocument();
    await waitFor(() => {
      const headers = screen.getAllByRole("columnheader").map((header) => header.textContent?.trim());
      expect(headers.slice(0, 4)).toEqual(["部门", "课室", "客户", "业务员"]);
    });
  });

  it("always opens in browse mode and only renders editors after an authorized user enters edit mode", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><BusinessCustomerMappingsPage /></QueryClientProvider>);

    expect(await screen.findByText("A001")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("A001")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除对应关系" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /进入编辑模式/ }));
    expect(await screen.findByDisplayValue("A001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除对应关系" })).toBeInTheDocument();
  });

  it("does not offer edit mode without update permission", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "viewer-1", permissions: ["business-customer-mapping:*:read"] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><BusinessCustomerMappingsPage /></QueryClientProvider>);

    expect(await screen.findByText("A001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /进入编辑模式/ })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("A001")).not.toBeInTheDocument();
  });
});
