import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { api } from "../../api";
import { MasterPlanResourcePage, isMasterPlanSupportField } from "./MasterPlanPages";

vi.mock("../../api", () => ({ api: vi.fn() }));

/**
 * KN-MPS-UI-001：主计划主表精简。
 * 即使 metadata 里因为兼容仍带着辅助计算字段（累计报工 / 报工次数 / 每工序已下达数量），
 * 它们也绝不能成为主表列；月计划只允许一个「已下达周计划数量」。
 */
const processKeys = (code: string) => [
  { key: `${code}CycleDays`, label: "下料·所需周期", type: "number", editable: false },
  { key: `${code}DueDate`, label: "下料·交期", type: "date", editable: false },
  { key: `${code}Status`, label: "下料·状态", type: "dictionary", editable: false },
  { key: `${code}ProductionProgress`, label: "下料·生产进度", type: "number", editable: false, format: "percentage" }
];
const legacySupportFields = [
  { key: "cuttingReportedQuantity", label: "下料·累计报工", type: "number", editable: false },
  { key: "cuttingReportCount", label: "下料·报工次数", type: "number", editable: false },
  { key: "cuttingDispatchedQuantity", label: "下料·已下达周计划数量", type: "number", editable: false }
];

function renderPage(resource: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/master-plan-system/${resource}`]}>
        <Routes><Route path="/master-plan-system/:resource" element={<ResourceRoute />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
function ResourceRoute() {
  const { resource } = useParams();
  return <MasterPlanResourcePage resource={String(resource)} />;
}

function headersOf(container: HTMLElement) {
  return [...container.querySelectorAll(".ant-table-thead th")].map((cell) => (cell.textContent ?? "").trim());
}

describe("KN-MPS-UI-001 主计划主表精简与辅助字段防泄露", () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["*"], isSystemAdmin: true }));
  });
  afterEach(cleanup);

  it("辅助字段判定覆盖累计报工/报工次数/每工序已下达数量，但不误伤月计划唯一已下达数量", () => {
    expect(isMasterPlanSupportField("cuttingReportedQuantity")).toBe(true);
    expect(isMasterPlanSupportField("machiningReportCount")).toBe(true);
    expect(isMasterPlanSupportField("packagingDispatchedQuantity")).toBe(true);
    expect(isMasterPlanSupportField("dispatchedWeeklyQuantity")).toBe(false);
    expect(isMasterPlanSupportField("cuttingProductionProgress")).toBe(false);
    expect(isMasterPlanSupportField("exceptionSummary")).toBe(false);
  });

  it.each([["月计划", "mps-monthly-plans"], ["周计划", "mps-weekly-plans"]] as const)(
    "%s：即使 metadata 带着辅助字段也不出现累计报工/报工次数列，每工序仍是 周期/交期/状态/生产进度，异常只有一列",
    async (label, resource) => {
      const fields = [
        { key: "orderNumber", label: "订单编号", type: "text", editable: false },
        { key: "requiredQuantity", label: "需求数量", type: "number", editable: false },
        /* 「已下达周计划数量」只属于月计划；周计划 metadata 里根本不应该有这个字段。 */
        ...(resource === "mps-monthly-plans" ? [{ key: "dispatchedWeeklyQuantity", label: "已下达周计划数量", type: "number", editable: false }] : []),
        ...processKeys("cutting"),
        ...legacySupportFields,
        { key: "exceptionSummary", label: "异常", type: "text", editable: false }
      ];
      vi.mocked(api).mockImplementation(async (path: string) => {
        if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
        if (path.endsWith("/meta")) return { resource, fields, createFields: [], actions: { create: false, update: false, delete: false, import: false, export: false, batchUpdate: false } } as never;
        if (path.startsWith(`/master-plan-system/resources/${resource}?`)) return { rows: [], total: 0 } as never;
        throw new Error(`unexpected request: ${path}`);
      });
      const { container } = renderPage(resource);
      /* 等 metadata 到位（基础字段出现）后再取表头，避免读到加载中的空表头。 */
      await waitFor(() => expect(headersOf(container)).toContain("订单编号"));
      const headers = headersOf(container);

      /* 辅助计算字段绝不出现在主表列。 */
      expect(`${label}:${headers.some((header) => header.includes("累计报工"))}`).toBe(`${label}:false`);
      expect(`${label}:${headers.some((header) => header.includes("报工次数"))}`).toBe(`${label}:false`);
      /* 每工序仍是 周期 / 交期 / 状态 / 生产进度。 */
      for (const title of ["所需周期", "交期", "状态", "生产进度"]) expect(`${label}:${headers.includes(title)}`).toBe(`${label}:true`);
      /* 整表只有一个异常列。 */
      expect(headers.filter((header) => header === "异常")).toHaveLength(1);
      /* 月计划只有一个已下达周计划数量；周计划完全没有。 */
      expect(`${label}:${headers.filter((header) => header === "已下达周计划数量").length}`).toBe(resource === "mps-monthly-plans" ? `${label}:1` : `${label}:0`);
    }, 20_000);

  it("月计划基础数量区域顺序：需求数量 → 已下达周计划数量 → 累计入库数量 → 欠数", async () => {
    const fields = [
      { key: "requiredQuantity", label: "需求数量", type: "number", editable: false },
      { key: "dispatchedWeeklyQuantity", label: "已下达周计划数量", type: "number", editable: false },
      { key: "cumulativeInboundQuantity", label: "累计入库数量", type: "number", editable: false },
      { key: "pendingQuantity", label: "欠数", type: "number", editable: false },
      { key: "exceptionSummary", label: "异常", type: "text", editable: false }
    ];
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return { resource: "mps-monthly-plans", fields, createFields: [], actions: { create: false, update: false, delete: false, import: false, export: false, batchUpdate: false } } as never;
      if (path.startsWith("/master-plan-system/resources/mps-monthly-plans?")) return { rows: [], total: 0 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const { container } = renderPage("mps-monthly-plans");
    await waitFor(() => expect(headersOf(container)).toContain("需求数量"));
    const headers = headersOf(container);
    const positions = ["需求数量", "已下达周计划数量", "累计入库数量", "欠数"].map((title) => headers.indexOf(title));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(headers).toContain("异常");
  }, 20_000);
});
