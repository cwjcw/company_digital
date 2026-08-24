import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { OrderSchedulePage } from "./MarketingPages";

vi.mock("../../api", () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {}
}));

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

    const itemName = await screen.findByLabelText("品项名称");
    expect(screen.getByLabelText("客户交期")).toHaveValue("8月28日");
    fireEvent.change(itemName, { target: { value: "演示品项（已调整）" } });
    fireEvent.click(screen.getByRole("button", { name: /OK|确 定/ }));

    await waitFor(() => expect(api).toHaveBeenCalledWith("/marketing/order-schedules/schedule-1", expect.objectContaining({ method: "PATCH" })));
    const updateCall = vi.mocked(api).mock.calls.find(([path]) => path === "/marketing/order-schedules/schedule-1");
    expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({ itemName: "演示品项（已调整）", sourcePlanItemId: "plan-item-1", expectedVersion: 3 });
  });
});
