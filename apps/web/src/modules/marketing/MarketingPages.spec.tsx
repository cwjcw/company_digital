import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, Modal } from "antd";
import zhCN from "antd/locale/zh_CN";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { BusinessCustomerMappingsPage, DivisionOrderReviewPage, OrderSchedulePage } from "./MarketingPages";

vi.mock("../../api", () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {}
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const schedule = {
  id: "schedule-1", customerCode: "DEMO-C001", orderNumber: "DEMO-SO-001", itemNumber: "DEMO-P001",
  department: "欧美业务一部", section: "一课", salespersonUserIds: ["00000000-0000-7000-8000-000000000003"], salespersonNames: ["张三"],
  itemName: "演示品项", customerDueDate: "2026-08-28", orderTotalQuantity: "100.0000", productionUnit: "演示一厂",
  completionRatio: "25.0000", sourcePlanItemId: "plan-item-1", version: 3
};

describe("OrderSchedulePage editing", () => {
  beforeEach(() => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["order-schedule:*:read", "order-schedule:*:update", "order-schedule:*:delete", "order-schedule:*:import"] }));
    vi.mocked(api).mockReset();
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith("/marketing/order-schedules?") && !init?.method) return [schedule] as never;
      if (path === "/marketing/order-schedules/schedule-1" && init?.method === "PATCH") return { ...schedule, version: 4 } as never;
      if (path === "/marketing/order-schedules/batch-delete" && init?.method === "POST") return { deleted: 1 } as never;
      throw new Error(`unexpected API call: ${path}`);
    });
  });

  it("edits the selected schedule while preserving its planning source", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<ConfigProvider locale={zhCN}><QueryClientProvider client={client}><OrderSchedulePage /></QueryClientProvider></ConfigProvider>);

    expect(await screen.findByText("DEMO-SO-001")).toBeInTheDocument();
    expect(screen.getByText("8月28日")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(screen.getByRole("button", { name: "编辑所选" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑订单排期" });
    const itemName = within(dialog).getByLabelText("品项名称");
    expect(within(dialog).getByLabelText("客户交期")).toHaveValue("8月28日");
    fireEvent.change(itemName, { target: { value: "演示品项（已调整）" } });
    fireEvent.click(screen.getByRole("button", { name: /确 定|确定/ }));

    await waitFor(() => expect(api).toHaveBeenCalledWith("/marketing/order-schedules/schedule-1", expect.objectContaining({ method: "PATCH" })));
    const updateCall = vi.mocked(api).mock.calls.find(([path]) => path === "/marketing/order-schedules/schedule-1");
    expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({ itemName: "演示品项（已调整）", sourcePlanItemId: "plan-item-1", expectedVersion: 3 });
  }, 10_000);

  it("shows read-only business ownership fields without synchronization actions", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<ConfigProvider locale={zhCN}><QueryClientProvider client={client}><OrderSchedulePage /></QueryClientProvider></ConfigProvider>);

    expect(await screen.findByText("欧美业务一部")).toBeInTheDocument();
    expect(screen.getByText("一课")).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "从主计划同步" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "从业务人员与客户对应表同步" })).not.toBeInTheDocument();
  });

  it("deletes the selected schedule from the top action bar", async () => {
    const confirm = vi.spyOn(Modal, "confirm").mockReturnValue({} as ReturnType<typeof Modal.confirm>);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<ConfigProvider locale={zhCN}><QueryClientProvider client={client}><OrderSchedulePage /></QueryClientProvider></ConfigProvider>);

    expect(await screen.findByText("DEMO-SO-001")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    fireEvent.click(screen.getByRole("button", { name: /删除所选 1 条/ }));
    expect(confirm).toHaveBeenCalledOnce();
    await confirm.mock.calls[0]![0].onOk?.();

    await waitFor(() => expect(api).toHaveBeenCalledWith("/marketing/order-schedules/batch-delete", expect.objectContaining({ method: "POST" })));
    const deleteCall = vi.mocked(api).mock.calls.find(([path]) => path === "/marketing/order-schedules/batch-delete");
    expect(JSON.parse(String(deleteCall?.[1]?.body))).toEqual({ rows: [{ id: "schedule-1", expectedVersion: 3 }] });
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
      if (path === "/marketing/directory-organizations") return [{ id: "org-1", name: "业务一部（欧美）", parentId: null, path: ["业务一部（欧美）"], pathLabel: "业务一部（欧美）", enabled: true }] as never;
      throw new Error(`unexpected API call: ${path}`);
    });
  });

  it("uses customer granularity and the required business-field order", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<ConfigProvider locale={zhCN}><QueryClientProvider client={client}><BusinessCustomerMappingsPage /></QueryClientProvider></ConfigProvider>);

    expect(await screen.findByRole("heading", { name: "业务人员与客户对应表" })).toBeInTheDocument();
    await waitFor(() => {
      const headers = screen.getAllByRole("columnheader").map((header) => header.textContent?.trim()).filter(Boolean);
      expect(headers.slice(0, 4)).toEqual(["部门", "课室", "客户", "业务员"]);
    });
  });

  it("always opens in browse mode and only renders editors after an authorized user enters edit mode", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<ConfigProvider locale={zhCN}><QueryClientProvider client={client}><BusinessCustomerMappingsPage /></QueryClientProvider></ConfigProvider>);

    expect(await screen.findByText("A001")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("A001")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除对应关系" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /进入编辑模式/ }));
    expect(await screen.findByDisplayValue("A001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("一课")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除对应关系" })).toBeInTheDocument();
  });

  it("does not offer edit mode without update permission", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "viewer-1", permissions: ["business-customer-mapping:*:read"] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<ConfigProvider locale={zhCN}><QueryClientProvider client={client}><BusinessCustomerMappingsPage /></QueryClientProvider></ConfigProvider>);

    expect(await screen.findByText("A001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /进入编辑模式/ })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("A001")).not.toBeInTheDocument();
  });
});

describe("DivisionOrderReviewPage", () => {
  beforeEach(() => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "reviewer-1", permissions: ["division-order-review:*:read", "division-order-review:*:update", "division-order-review:divisionReviewDueDate:update", "division-order-review:deliveryConfirmation:read", "rolling-plan-table:*:import"] }));
    vi.mocked(api).mockReset();
    const rows = [1, 2].map((index) => ({
      id: `00000000-0000-7000-8000-00000000005${index}`, version: index, customerCode: `C00${index}`,
      orderNumber: `SO00${index}`, itemNumber: `ITEM00${index}`, itemName: `品项${index}`,
      customerDueDate: "2026-09-20", divisionReviewDueDate: "2026-09-18", deliveryConfirmation: "待确认",
      orderTotalQuantity: "10.0000", productionUnit: "业务一部", completionRatio: "0", status: "NORMAL"
    }));
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith("/marketing/division-order-reviews?") && !init?.method) return { rows, total: 2, page: 1, pageSize: 50 } as never;
      if (path === "/marketing/division-order-reviews/confirm" && init?.method === "POST") return { selected: 2, eligible: 2, matched: 1, created: 1, updated: 1, unchanged: 0, confirmed: 2, failed: [] } as never;
      throw new Error(`unexpected API call: ${path}`);
    });
  });

  it("shows the two new fields and batch-confirms selected reviews", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<ConfigProvider locale={zhCN}><QueryClientProvider client={client}><DivisionOrderReviewPage /></QueryClientProvider></ConfigProvider>);

    expect(await screen.findByText("SO001")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /事业部评审交期/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /交期确认/ })).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]!);
    fireEvent.click(checkboxes[2]!);
    fireEvent.click(screen.getByRole("button", { name: "批量交期确认（2）" }));

    await waitFor(() => expect(api).toHaveBeenCalledWith("/marketing/division-order-reviews/confirm", expect.objectContaining({ method: "POST" })));
    const confirmCall = vi.mocked(api).mock.calls.find(([path]) => path === "/marketing/division-order-reviews/confirm");
    expect(JSON.parse(String(confirmCall?.[1]?.body)).rows).toEqual([
      { id: "00000000-0000-7000-8000-000000000051", expectedVersion: 1 },
      { id: "00000000-0000-7000-8000-000000000052", expectedVersion: 2 }
    ]);
  });
});
