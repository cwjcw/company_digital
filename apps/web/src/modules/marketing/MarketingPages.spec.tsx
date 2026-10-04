import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { BusinessCustomerMappingsPage, OrderSchedulePage } from "./MarketingPages";

vi.mock("../../api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../api")>();
  return { ...original, api: vi.fn() };
});

function renderPage(page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<AntApp><QueryClientProvider client={client}>{page}</QueryClientProvider></AntApp>);
}

function grantDelete(resource: string) {
  localStorage.setItem("sessionUser", JSON.stringify({ sub: "tester", permissions: [`${resource}:*:read`, `${resource}:*:delete`] }));
}

afterEach(() => cleanup());

describe("marketing standard table top delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("业务人员与客户对应表从顶部删除，并继续调用带版本的正式单条 API", async () => {
    grantDelete("business-customer-mapping");
    const row = { id: "mapping-1", departmentId: "department-1", department: "营销部", section: "一课", customerCode: "C001", salespersonUserIds: [], salespersonUsers: [], version: 3, canDelete: true };
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/marketing/business-customer-mappings?")) return { rows: [row], total: 1, page: 1, pageSize: 100 } as never;
      if (path === "/marketing/directory-users" || path === "/marketing/directory-organizations") return [] as never;
      if (path === "/marketing/business-customer-mappings/mapping-1" && init?.method === "DELETE") return {} as never;
      return [] as never;
    });

    const view = renderPage(<BusinessCustomerMappingsPage />);
    const deleteButton = await screen.findByRole("button", { name: "删除" });
    expect(deleteButton).toBeDisabled();
    const customer = await screen.findByText("C001");
    fireEvent.click(customer.closest("tr")!.querySelector("input[type=checkbox]")!);
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);
    const dialog = await screen.findByRole("dialog", { name: "确认删除选中的 1 条业务人员与客户对应关系？" });
    fireEvent.click(dialog.querySelector(".ant-modal-confirm-btns .ant-btn-primary")!);

    await waitFor(() => expect(api).toHaveBeenCalledWith("/marketing/business-customer-mappings/mapping-1", {
      method: "DELETE", body: JSON.stringify({ expectedVersion: 3 })
    }));
    expect(view.container.querySelector("th.ant-table-cell-fix-right")).not.toBeInTheDocument();
  });

  it("订单排期使用公共顶部删除并复用正式 batch-delete API", async () => {
    grantDelete("order-schedule");
    const row = { id: "schedule-1", customerCode: "C001", orderNumber: "ORD-1", itemNumber: "ITEM-1", itemName: "产品一", orderTotalQuantity: "10", completionRatio: "0", status: "NORMAL", salespersonNames: [], version: 7, canDelete: true };
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/marketing/order-schedules?")) return { rows: [row], total: 1, page: 1, pageSize: 100 } as never;
      if (path === "/marketing/order-schedules/batch-delete" && init?.method === "POST") return { deleted: 1 } as never;
      return [] as never;
    });

    renderPage(<OrderSchedulePage />);
    const deleteButton = await screen.findByRole("button", { name: "删除" });
    const order = await screen.findByText("ORD-1");
    fireEvent.click(order.closest("tr")!.querySelector("input[type=checkbox]")!);
    await waitFor(() => expect(deleteButton).toBeEnabled());
    fireEvent.click(deleteButton);
    const dialog = await screen.findByRole("dialog", { name: "确认删除选中的 1 条订单排期？" });
    fireEvent.click(dialog.querySelector(".ant-modal-confirm-btns .ant-btn-primary")!);

    await waitFor(() => expect(api).toHaveBeenCalledWith("/marketing/order-schedules/batch-delete", {
      method: "POST", body: JSON.stringify({ rows: [{ id: "schedule-1", expectedVersion: 7 }] })
    }));
    expect(screen.queryByText("操作")).not.toBeInTheDocument();
  });
});
