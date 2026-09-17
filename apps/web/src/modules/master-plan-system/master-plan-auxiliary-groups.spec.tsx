import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { api } from "../../api";
import { MasterPlanResourcePage, auxiliaryPlanGroups } from "./MasterPlanPages";

vi.mock("../../api", () => ({ api: vi.fn() }));

/**
 * KN-MPS-UI-001 补充：事业部月计划与周计划的辅助计划一级分组结构必须完全一致。
 * 技术/图纸计划 → 五金主材计划 → 木作主材计划 → 外协计划 → 10 个标准工序 → 异常。
 * 一级分组结构由正式定义决定，不能由“当前可见字段”临时推导（字段权限只影响组内可见字段）。
 */
const auxiliaryBaseFields = [
  { key: "orderNumber", label: "订单编号", type: "text", editable: false },
  { key: "requiredQuantity", label: "需求数量", type: "number", editable: false },
  { key: "pendingQuantity", label: "欠数", type: "number", editable: false }
];
const auxiliaryFields = [
  { key: "technicalCycleDays", label: "技术/图纸计划·所需周期", type: "number", editable: false },
  { key: "drawingDueDate", label: "技术/图纸计划·图纸交期", type: "date", editable: false },
  { key: "technicalStatus", label: "技术/图纸计划·状态", type: "dictionary", editable: false },
  { key: "hardwareCycleDays", label: "五金主材计划·所需周期", type: "number", editable: false },
  { key: "hardwareDueDate", label: "五金主材计划·交期", type: "date", editable: false },
  { key: "hardwareStatus", label: "五金主材计划·状态", type: "dictionary", editable: false },
  { key: "woodCycleDays", label: "木作主材计划·所需周期", type: "number", editable: false },
  { key: "woodDueDate", label: "木作主材计划·交期", type: "date", editable: false },
  { key: "woodStatus", label: "木作主材计划·状态", type: "dictionary", editable: false },
  { key: "outsourcingCycleDays", label: "外协计划·所需周期", type: "number", editable: false },
  { key: "outsourcingDueDate", label: "外协计划·交期", type: "date", editable: false },
  { key: "outsourcingStatus", label: "外协计划·状态", type: "dictionary", editable: false },
  { key: "outsourcingActualInboundDate", label: "外协计划·实际入库日期", type: "date", editable: false }
];
const processFields = ["cutting", "machining"].flatMap((code, index) => [
  { key: `${code}CycleDays`, label: `${index === 0 ? "下料" : "机加"}·所需周期`, type: "number", editable: false },
  { key: `${code}DueDate`, label: `${index === 0 ? "下料" : "机加"}·交期`, type: "date", editable: false },
  { key: `${code}Status`, label: `${index === 0 ? "下料" : "机加"}·状态`, type: "dictionary", editable: false },
  { key: `${code}ProductionProgress`, label: `${index === 0 ? "下料" : "机加"}·生产进度`, type: "number", editable: false, format: "percentage" }
]);
const allFields = [...auxiliaryBaseFields, ...auxiliaryFields, ...processFields, { key: "exceptionSummary", label: "异常", type: "text", editable: false }];

function ResourceRoute() {
  const { resource } = useParams();
  return <MasterPlanResourcePage resource={String(resource)} />;
}
function renderPage(resource: string, fields: typeof allFields = allFields) {
  localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["*"], isSystemAdmin: true }));
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
    if (path.endsWith("/meta")) return { resource, fields, createFields: [], actions: { create: false, update: false, delete: false, import: false, export: false, batchUpdate: false } } as never;
    if (path.startsWith(`/master-plan-system/resources/${resource}?`)) return { rows: [], total: 0 } as never;
    throw new Error(`unexpected request: ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/master-plan-system/${resource}`]}>
        <Routes><Route path="/master-plan-system/:resource" element={<ResourceRoute />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const processNames = ["下料", "机加", "折弯", "点焊", "焊接", "木作", "研磨", "毛坯", "表面处理", "包装"];
const knownGroupTitles = [...auxiliaryPlanGroups.map((group) => group.title), ...processNames];
const auxiliarySubTitles = ["所需周期", "图纸交期", "交期", "状态", "实际入库日期"];

/** 把两层表头解析成 { 一级分组标题 → 组内子标题 }，以及不参与分组的 leading 列标题。 */
function headerStructure(container: HTMLElement) {
  const rows = [...container.querySelectorAll(".ant-table-thead tr")];
  const top = rows[0] ? [...rows[0].querySelectorAll("th")] : [];
  const sub = rows[1] ? [...rows[1].querySelectorAll("th")].map((cell) => (cell.textContent ?? "").trim()) : [];
  const groups: Array<{ title: string; children: string[] }> = [];
  const leading: string[] = [];
  let subIndex = 0;
  for (const cell of top) {
    const title = (cell.textContent ?? "").trim();
    const span = Number(cell.getAttribute("colspan") ?? "1");
    /* antd 对只有 1 个子列的组不写 colspan，因此用正式分组名兜底识别（占位组也算组，不能算 leading）。 */
    if (span > 1 || knownGroupTitles.includes(title)) { groups.push({ title, children: sub.slice(subIndex, subIndex + span) }); subIndex += span; }
    else leading.push(title);
  }
  return { groups, leading, all: [...top, ...rows[1]?.querySelectorAll("th") ?? []].map((cell) => (cell.textContent ?? "").trim()) };
}

describe("KN-MPS-UI-001 月计划辅助计划一级分组与周计划对齐", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
  afterEach(cleanup);

  it("辅助计划分组只有一个正式定义：标题、顺序、语义唯一", () => {
    expect(auxiliaryPlanGroups.map((group) => group.title)).toEqual(["技术/图纸计划", "五金主材计划", "木作主材计划", "外协计划"]);
    expect(auxiliaryPlanGroups.map((group) => group.key)).toEqual(["technical", "hardware", "wood", "outsourcing"]);
    expect(new Set(auxiliaryPlanGroups.flatMap((group) => group.fields)).size).toBe(13);
  });

  it.each([["周计划", "mps-weekly-plans"], ["月计划", "mps-monthly-plans"]] as const)(
    "%s：4 个辅助计划一级分组按固定顺序出现在 10 工序之前，且子字段落在组内",
    async (label, resource) => {
      const { container } = renderPage(resource);
      /* 等 metadata 到位（基础字段出现）后再取表头；分组标题来自静态定义，不能作为“已加载”的依据。 */
      await waitFor(() => expect(headerStructure(container).all).toContain("订单编号"));
      await waitFor(() => expect(headerStructure(container).all).toContain("技术/图纸计划"));
      const { groups, leading, all } = headerStructure(container);
      const titles = groups.map((group) => group.title);

      /* 4 个一级分组按正式顺序出现，且排在下料/机加等标准工序之前。 */
      expect(titles.slice(0, 4)).toEqual(["技术/图纸计划", "五金主材计划", "木作主材计划", "外协计划"]);
      expect(titles).toContain("下料");
      expect(all.indexOf("外协计划")).toBeLessThan(all.indexOf("下料"));
      /* 组内子字段结构（顺序取自定义，周/月一致）。 */
      expect(groups[0]!.children).toEqual(["所需周期", "图纸交期", "状态"]);
      expect(groups[1]!.children).toEqual(["所需周期", "交期", "状态"]);
      expect(groups[2]!.children).toEqual(["所需周期", "交期", "状态"]);
      expect(groups[3]!.children).toEqual(["所需周期", "交期", "状态", "实际入库日期"]);
      /* 辅助字段绝不作为普通 leading 列（月计划曾经的缺陷）。 */
      expect(`${label}:${leading.filter((title) => auxiliarySubTitles.includes(title)).join(",")}`).toBe(`${label}:`);
      /* 基础字段仍按原顺序出现在最前面（leading 里还会包含工序占位组与审计列，这是平台既有行为）。 */
      expect(leading.slice(0, 4)).toEqual(["", "订单编号", "需求数量", "欠数"]);
      /* 标准 10 工序与唯一异常列不回归。 */
      for (const name of ["下料", "机加", "折弯", "点焊", "焊接", "木作", "研磨", "毛坯", "表面处理", "包装"]) expect(all).toContain(name);
      expect(all.filter((title) => title === "异常")).toHaveLength(1);
    }, 20_000);

  it("周计划与月计划的一级分组标题名与顺序完全一致", async () => {
    const weekly = renderPage("mps-weekly-plans");
    await waitFor(() => expect(headerStructure(weekly.container).all).toContain("订单编号"));
    await waitFor(() => expect(headerStructure(weekly.container).groups.map((group) => group.title)).toContain("技术/图纸计划"));
    const weeklyTitles = headerStructure(weekly.container).groups.map((group) => group.title);
    cleanup();
    const monthly = renderPage("mps-monthly-plans");
    await waitFor(() => expect(headerStructure(monthly.container).all).toContain("订单编号"));
    await waitFor(() => expect(headerStructure(monthly.container).groups.map((group) => group.title)).toContain("技术/图纸计划"));
    const monthlyTitles = headerStructure(monthly.container).groups.map((group) => group.title);

    /* 两张表的一级分组标题名与顺序完全一致：4 个辅助计划分组 → 10 个标准工序。 */
    expect(monthlyTitles).toEqual(weeklyTitles);
    expect(weeklyTitles.slice(0, 4)).toEqual(auxiliaryPlanGroups.map((group) => group.title));
    expect(weeklyTitles.slice(4)).toEqual(expect.arrayContaining(processNames.filter((name) => weeklyTitles.includes(name))));
    expect(weeklyTitles.indexOf("下料")).toBe(4);
  }, 30_000);

  it("权限只影响组内可见字段：缺少整个“技术/图纸计划”子字段读权限时，一级标题仍然保留", async () => {
    const withoutTechnical = allFields.filter((field) => !auxiliaryPlanGroups[0]!.fields.includes(field.key));
    const { container } = renderPage("mps-monthly-plans", withoutTechnical as typeof allFields);
    await waitFor(() => expect(headerStructure(container).all).toContain("订单编号"));
    await waitFor(() => expect(headerStructure(container).all).toContain("外协计划"));
    const { groups } = headerStructure(container);

    /* 一级标题与顺序保持不变。 */
    expect(groups.slice(0, 4).map((group) => group.title)).toEqual(["技术/图纸计划", "五金主材计划", "木作主材计划", "外协计划"]);
    /* 无可见字段的分组显示安全占位，不泄露数据。 */
    expect(groups[0]!.children).toEqual(["无可见字段"]);
    expect(groups[1]!.children).toEqual(["所需周期", "交期", "状态"]);
  }, 20_000);
});
