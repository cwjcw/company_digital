import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";
import { api } from "../api";
import { KdosDataTable } from "./KdosDataTable";
import { KdosPrintDocument, printTable, type TablePrintDto } from "./table-print";

/**
 * KN-PRINT-001：统一打印入口（按钮位置、权限、>300 确认、0 行提示）与打印 DOM/版式模型。
 */
vi.mock("../api", () => ({ api: vi.fn() }));

const fields: TablePermissionFieldDefinition[] = [
  { key: "orderNumber", label: "订单编号", type: "text", editable: true },
  { key: "quantity", label: "数量", type: "number", editable: true, format: "decimal" }
];
const columns = [
  { title: "订单编号", dataIndex: "orderNumber", key: "orderNumber" },
  { title: "数量", dataIndex: "quantity", key: "quantity" }
];
const capabilities = [{ code: "mps-weekly-plans", label: "事业部周计划", print: { status: "PRINTABLE" }, allowed: true }];

function renderTable(resource = "mps-weekly-plans", withSelectionActions = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <KdosDataTable resource={resource} filterFields={fields} columns={columns} rowKey="id"
      dataSource={[{ id: "r1", orderNumber: "A1", quantity: 1 }]}
      selectionActions={withSelectionActions ? () => null : undefined}
      serverData={{ total: 1, onQueryChange: vi.fn() }} />
  </QueryClientProvider>);
}

describe("KN-PRINT-001 标准表格打印入口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "u1", permissions: ["*"] }));
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/table-filters/resources") return [{ code: "mps-weekly-plans", filterableFields: fields.map((field) => field.key) }] as never;
      if (path === "/table-prints/capabilities") return capabilities as never;
      return [] as never;
    });
  });
  afterEach(() => cleanup());

  it("工具栏只提供「打印筛选结果」，不新增操作列", async () => {
    const { container } = renderTable();
    expect(await screen.findByRole("button", { name: /打印筛选结果/ })).toBeInTheDocument();
    /* 没有独立“操作”列，也没有行内打印按钮。 */
    expect(screen.queryByText("操作")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".ant-table-tbody button").length).toBe(0);
  });

  it("没有 batch_print 权限时不显示打印入口", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/table-filters/resources") return [{ code: "mps-weekly-plans", filterableFields: fields.map((field) => field.key) }] as never;
      if (path === "/table-prints/capabilities") return [{ ...capabilities[0], allowed: false }] as never;
      return [] as never;
    });
    renderTable();
    await waitFor(() => expect(screen.queryByRole("button", { name: /打印筛选结果/ })).not.toBeInTheDocument());
  });

  it("选中记录后在选择工具栏提供「打印已选（N）」", async () => {
    const { container } = renderTable();
    await screen.findByRole("button", { name: /打印筛选结果/ });
    const checkbox = container.querySelector(".ant-table-tbody .ant-checkbox-input") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(await screen.findByRole("button", { name: /打印已选（1）/ })).toBeInTheDocument();
  });

  it("打印筛选结果：先取 manifest，超过 300 条时要求确认，取消则不请求渲染", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/table-prints/manifest")) return { resource: "mps-weekly-plans", title: "事业部周计划", printable: true, total: 1248, columns: [], headerGroups: [], orientation: "landscape", batchSize: 200, confirmThreshold: 300, largeWarningThreshold: 3000 } as never;
      return [] as never;
    });
    const result = await printTable({ resource: "mps-weekly-plans", confirm });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("1,248"));
    expect(result.printed).toBe(false);
    expect(result.reason).toBe("cancelled");
    expect(vi.mocked(api).mock.calls.some(([path]) => String(path) === "/table-prints/render")).toBe(false);
  });

  it("超大数据（>3000）使用更强的二次警示文案", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/table-prints/manifest")) return { resource: "sales-orders", title: "订单表", printable: true, total: 97843, columns: [], headerGroups: [], orientation: "landscape", batchSize: 200, confirmThreshold: 300, largeWarningThreshold: 3000 } as never;
      return [] as never;
    });
    await printTable({ resource: "sales-orders", confirm });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("建议进一步筛选后再打印"));
  });

  it("0 行不打开空白打印页", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/table-prints/manifest")) return { resource: "mps-weekly-plans", title: "事业部周计划", printable: true, total: 0, columns: [], headerGroups: [], orientation: "portrait", batchSize: 200, confirmThreshold: 300, largeWarningThreshold: 3000 } as never;
      return [] as never;
    });
    const result = await printTable({ resource: "mps-weekly-plans" });
    expect(result.printed).toBe(false);
    expect(result.reason).toBe("empty");
  });
});

describe("KN-PRINT-001 打印文档模型", () => {
  const dto: TablePrintDto = {
    title: "事业部周计划",
    resource: "mps-weekly-plans",
    columns: [
      { key: "orderNumber", label: "订单编号", align: "left", width: 12 },
      { key: "quantity", label: "数量", align: "right", width: 9 }
    ],
    headerGroups: [{ label: "计划", columns: ["orderNumber", "quantity"] }],
    rows: [{ orderNumber: "A1", quantity: "1" }],
    meta: {
      rangeType: "FILTERED", total: 1, printedCount: 1, orientation: "landscape",
      filtered: true, searched: false, printedAt: "2026-09-16T12:00:00.000Z", printedBy: "u1"
    }
  };

  afterEach(() => cleanup());

  it("打印根节点带方向 class，包含表头、分组表头与打印信息", () => {
    render(<KdosPrintDocument dto={dto} />);
    const root = screen.getByTestId("kdos-print-root");
    expect(root.className).toContain("orientation-landscape");
    expect(within(root).getByText("凯南数字化工作台")).toBeInTheDocument();
    expect(within(root).getByText("事业部周计划")).toBeInTheDocument();
    expect(within(root).getByText(/已应用搜索和筛选条件/)).toBeInTheDocument();
    expect(within(root).getByText(/打印范围：筛选结果，共 1 条/)).toBeInTheDocument();
    expect(within(root).getByText("计划")).toBeInTheDocument();
    expect(screen.getByTestId("kdos-print-table").querySelector("thead")).toBeTruthy();
  });

  it("纵向文档使用 portrait class", () => {
    render(<KdosPrintDocument dto={{ ...dto, meta: { ...dto.meta, orientation: "portrait" } }} />);
    expect(screen.getByTestId("kdos-print-root").className).toContain("orientation-portrait");
  });
});
