import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { api } from "../../api";
import { MasterPlanResourcePage, ProductionDateCell, formatProductionDateRange, formatWorkOrderSyncResult } from "./MasterPlanPages";

vi.mock("../../api", () => ({ api: vi.fn() }));

/**
 * KN-MPS-WO-001：3天生产工单页面契约。
 * - 生产日期是「一个合并列 + RangePicker」（数据库仍是两个原子 date 字段）；
 * - 不出现交期编码、不出现独立操作列、不出现来源周计划 UUID 列；
 * - 页面级「从周计划同步」按钮只在有维护权限时出现，同步结果按 新增/更新/未变化 反馈。
 */
const workOrderFields = [
  { key: "customerCode", label: "客户代码", type: "text", editable: false },
  { key: "orderNumber", label: "订单编号", type: "text", editable: false },
  { key: "itemCode", label: "品项编码", type: "text", editable: false },
  { key: "itemName", label: "品项名称", type: "text", editable: false },
  { key: "imageRefs", label: "简图", type: "attachment", editable: false },
  { key: "requiredQuantity", label: "需求数量", type: "number", editable: false },
  { key: "blankCompletionDate", label: "毛坯完成日期", type: "date", editable: false },
  { key: "packagingCompletionDate", label: "包装完成日期", type: "date", editable: false },
  { key: "productionStartDate", label: "生产开始日期", type: "date", editable: true },
  { key: "productionEndDate", label: "生产结束日期", type: "date", editable: true },
  { key: "productionDateRange", label: "生产日期", type: "text", editable: false, filterable: false },
  { key: "remark", label: "备注", type: "text", editable: true },
  { key: "processingRemark", label: "加工备注", type: "text", editable: true },
  { key: "divisionId", label: "承接事业部", type: "department", editable: false },
  { key: "weeklyPlanId", label: "来源周计划", type: "reference", editable: false }
];
const row = {
  id: "row-1", version: 3, customerCode: "0001", orderNumber: "O001", itemCode: "P001", itemName: "品项",
  requiredQuantity: "100.0000", productionStartDate: "2026-09-20", productionEndDate: "2026-09-22",
  weeklyPlanId: "33333333-3333-4333-8333-333333333333", divisionId: "d23442f9-4862-4641-b4a7-c8d470bc56ea",
  canUpdate: true, canDelete: false
};

function ResourceRoute() {
  const { resource } = useParams();
  return <MasterPlanResourcePage resource={String(resource)} />;
}
function renderPage(actions: Partial<Record<string, boolean>> = {}) {
  localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["*"], isSystemAdmin: true }));
  vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
    if (path.endsWith("/meta")) return { resource: "mps-three-day-work-orders", fields: workOrderFields, createFields: [], actions: { create: false, update: true, delete: false, import: true, export: true, batchUpdate: false, ...actions } } as never;
    if (path.includes("sync-from-weekly") && init?.method === "POST") return { scanned: 5, created: 2, updated: 1, unchanged: 2, skipped: 0 } as never;
    if (path.startsWith("/master-plan-system/resources/mps-three-day-work-orders?")) return { rows: [row], total: 1 } as never;
    throw new Error(`unexpected request: ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/master-plan-system/mps-three-day-work-orders"]}>
        <Routes><Route path="/master-plan-system/:resource" element={<ResourceRoute />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("KN-MPS-WO-001 生产日期范围展示", () => {
  afterEach(cleanup);

  it("同日显示单日、范围显示 ～、空值显示 —", () => {
    expect(formatProductionDateRange("2026-09-20", "2026-09-22")).toBe("2026-09-20 ～ 2026-09-22");
    expect(formatProductionDateRange("2026-09-20", "2026-09-20")).toBe("2026-09-20");
    expect(formatProductionDateRange(null, null)).toBe("—");
    expect(formatProductionDateRange("2026-09-20", null)).toBe("2026-09-20");
  });

  it("RangePicker 选择后把两个原子字段一次性交给保存回调（不限制天数）", async () => {
    const onSaveRange = vi.fn();
    render(<ProductionDateCell row={{ productionStartDate: null, productionEndDate: null }} onSaveRange={onSaveRange} />);
    /* 只读浏览模式下不出现任何日期控件。 */
    expect(document.querySelector(".ant-picker-range")).toBeNull();
  });
});

describe("KN-MPS-WO-001 3天生产工单页面", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
  afterEach(cleanup);

  it("表格只显示一个「生产日期」列：无交期编码、无生产开始/结束列、无来源周计划列、无操作列", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll(".ant-table-thead th").length).toBeGreaterThan(0));
    await waitFor(() => expect(Array.from(container.querySelectorAll(".ant-table-thead th")).map((cell) => cell.textContent?.trim() ?? "")).toContain("生产日期"));
    const headers = Array.from(container.querySelectorAll(".ant-table-thead th")).map((cell) => cell.textContent?.trim() ?? "");
    expect(headers.filter((header) => header === "生产日期")).toHaveLength(1);
    expect(headers).not.toContain("生产开始日期");
    expect(headers).not.toContain("生产结束日期");
    expect(headers).not.toContain("交期编码");
    expect(headers).not.toContain("来源周计划");
    expect(headers).not.toContain("操作");
    expect(headers).not.toContain("更多操作");
    /* 不生成最右侧行操作列。 */
    expect(container.querySelectorAll(".ant-table-tbody td.kdos-row-actions, .ant-table-thead th.kdos-row-actions")).toHaveLength(0);
    expect(await screen.findByText("2026-09-20 ～ 2026-09-22")).toBeInTheDocument();
    /* 简图列为空时显示占位，不把附件 JSON 铺进表格。 */
    expect(screen.queryByText("[]")).not.toBeInTheDocument();
  }, 20_000);

  it("从周计划同步：按钮触发同步接口并按 新增/更新/未变化 反馈", async () => {
    renderPage();
    const button = await screen.findByRole("button", { name: /从周计划同步/ });
    fireEvent.click(button);
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("/master-plan-system/resources/mps-three-day-work-orders/sync-from-weekly", expect.objectContaining({ method: "POST" })));
    /* 同步后必须重新拉取列表（不做前端本地伪造）。 */
    await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([path]) => String(path).startsWith("/master-plan-system/resources/mps-three-day-work-orders?")).length).toBeGreaterThan(1));
    /* 反馈文案必须包含 新增/更新/未变化/跳过。 */
    expect(formatWorkOrderSyncResult({ created: 2, updated: 1, unchanged: 2, skipped: 0 })).toBe("同步完成：新增 2 条，更新 1 条，未变化 2 条");
    expect(formatWorkOrderSyncResult({ created: 0, updated: 0, unchanged: 4, skipped: 1 })).toBe("同步完成：新增 0 条，更新 0 条，未变化 4 条，跳过 1 条");
  }, 20_000);

  it("进入编辑模式后生产日期列提供 RangePicker（不需要分别打开两个日期控件）", async () => {
    const { container } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    await waitFor(() => expect(container.querySelector(".ant-picker-range")).toBeTruthy());
    const picker = container.querySelector(".ant-picker-range") as HTMLElement;
    const inputs = within(picker).getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs[0]!.value).toBe("2026-09-20");
    expect(inputs[1]!.value).toBe("2026-09-22");
  }, 20_000);
});
