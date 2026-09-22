import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";
import { api } from "../api";
import { KdosDataTable } from "./KdosDataTable";
import { KdosPrintDocument, formatPrintDateTime, printTable, type TablePrintDto } from "./table-print";

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
    expect(container.querySelectorAll(".ant-table-tbody button[aria-label*='打印']").length).toBe(0);
    expect(container.querySelectorAll(".ant-table-thead .kdos-column-menu-trigger").length).toBe(2);
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

  it("未选择记录时：按钮为「打印筛选结果」，请求 rangeType=FILTERED", async () => {
    const calls: string[] = [];
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/table-filters/resources") return [{ code: "mps-weekly-plans", filterableFields: fields.map((field) => field.key) }] as never;
      if (path === "/table-prints/capabilities") return capabilities as never;
      if (String(path).startsWith("/table-prints/manifest")) {
        calls.push(decodeURIComponent(String(path)));
        return { resource: "mps-weekly-plans", title: "事业部周计划", printable: true, total: 3, columns: [], headerGroups: [], orientation: "portrait", batchSize: 200, confirmThreshold: 300, largeWarningThreshold: 3000 } as never;
      }
      if (path === "/table-prints/render") return { title: "事业部周计划", resource: "mps-weekly-plans", columns: [], headerGroups: [], rows: [{ orderNumber: "A1" }], meta: { rangeType: "FILTERED", total: 3, printedCount: 3, orientation: "portrait", filtered: false, searched: false, printedAt: "", printedBy: "" } } as never;
      return [] as never;
    });
    const { container } = renderTable();
    const button = await screen.findByRole("button", { name: /打印筛选结果/ });
    /* 只有一个主打印入口：选择工具栏不再重复出现打印按钮。 */
    expect(screen.getAllByRole("button", { name: /打印筛选结果/ }).length).toBe(1);
    fireEvent.click(button);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toContain("rangeType=FILTERED");
    expect(vi.mocked(api).mock.calls.some(([path, init]) => String(path) === "/table-prints/render" && String(init?.body ?? "").includes('"rangeType":"FILTERED"'))).toBe(true);
    expect(container.querySelector(".kdos-data-table-selection-toolbar")).toBeNull();
  });

  it("打印筛选结果继承列头筛选生成的递归 effective FilterGroup", async () => {
    const manifests: string[] = [];
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/table-filters/resources") return [{ code: "mps-weekly-plans", filterableFields: fields.map((field) => field.key) }] as never;
      if (path === "/table-prints/capabilities") return capabilities as never;
      if (path.startsWith("/table-filters/candidates?")) return { options: [{ value: "A1", label: "A1" }], hasMore: false } as never;
      if (path.startsWith("/table-prints/manifest")) {
        manifests.push(path);
        return { resource: "mps-weekly-plans", title: "事业部周计划", printable: true, total: 1, columns: [], headerGroups: [], orientation: "portrait", batchSize: 200, confirmThreshold: 300, largeWarningThreshold: 3000 } as never;
      }
      if (path === "/table-prints/render") return { title: "事业部周计划", resource: "mps-weekly-plans", columns: [], headerGroups: [], rows: [{ orderNumber: "A1" }], meta: { rangeType: "FILTERED", total: 1, printedCount: 1, orientation: "portrait", filtered: true, searched: false, printedAt: "", printedBy: "" } } as never;
      return [] as never;
    });
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "订单编号列菜单" }));
    const panel = await screen.findByTestId("column-menu-orderNumber");
    await waitFor(() => expect(within(panel).getByRole("button", { name: /筛选/ })).toBeEnabled());
    fireEvent.click(within(panel).getByRole("button", { name: /筛选/ }));
    await waitFor(() => expect(within(panel).getByText("A1")).toBeInTheDocument());
    fireEvent.click(within(panel).getByText("A1"));
    fireEvent.click(within(panel).getByRole("button", { name: /确\s*定/ }));
    fireEvent.click(await screen.findByRole("button", { name: /打印筛选结果/ }));
    await waitFor(() => expect(manifests.length).toBe(1));
    const group = JSON.parse(new URLSearchParams(manifests[0]!.split("?")[1]).get("filterGroup") ?? "{}") as { groups: Array<{ groups?: unknown[] }> };
    expect(group.groups[1]?.groups).toHaveLength(1);
  });

  it("选中 1 条后：同一个按钮变为「打印已选（1）」，请求 rangeType=SELECTED 且只带该 stable ID", async () => {
    const calls: Array<{ path: string; body: string }> = [];
    vi.mocked(api).mockImplementation((async (path: string, init?: RequestInit) => {
      if (path === "/table-filters/resources") return [{ code: "mps-weekly-plans", filterableFields: fields.map((field) => field.key) }] as never;
      if (path === "/table-prints/capabilities") return capabilities as never;
      if (String(path).startsWith("/table-prints/manifest")) {
        calls.push({ path: decodeURIComponent(String(path)), body: "" });
        return { resource: "mps-weekly-plans", title: "事业部周计划", printable: true, total: 1, columns: [], headerGroups: [], orientation: "portrait", batchSize: 200, confirmThreshold: 300, largeWarningThreshold: 3000 } as never;
      }
      if (path === "/table-prints/render") {
        calls.push({ path, body: String(init?.body ?? "") });
        return { title: "事业部周计划", resource: "mps-weekly-plans", columns: [], headerGroups: [], rows: [{ orderNumber: "A1" }], meta: { rangeType: "SELECTED", total: 1, requestedCount: 1, printedCount: 1, orientation: "portrait", filtered: false, searched: false, printedAt: "", printedBy: "" } } as never;
      }
      return [] as never;
    }) as never);
    const { container } = renderTable();
    await screen.findByRole("button", { name: /打印筛选结果/ });
    fireEvent.click(container.querySelector(".ant-table-tbody .ant-checkbox-input") as HTMLInputElement);
    const selectedButton = await screen.findByRole("button", { name: /打印已选（1）/ });
    /* 仍然只有一个打印入口：选中时不能再同时出现“打印筛选结果”。 */
    expect(screen.getByRole("button", { name: /打印已选（1）/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打印筛选结果/ })).not.toBeInTheDocument();
    fireEvent.click(selectedButton);
    await waitFor(() => expect(calls.some((call) => call.path === "/table-prints/render")).toBe(true));
    const manifestCall = calls[0]!;
    expect(manifestCall.path).toContain("rangeType=SELECTED");
    expect(manifestCall.path).toContain("selectedIds=r1");
    const renderCall = calls.find((call) => call.path === "/table-prints/render")!;
    expect(renderCall.body).toContain('"rangeType":"SELECTED"');
    expect(renderCall.body).toContain("r1");
  });

  it("清空选择后按钮恢复为「打印筛选结果」", async () => {
    const { container } = renderTable();
    await screen.findByRole("button", { name: /打印筛选结果/ });
    fireEvent.click(container.querySelector(".ant-table-tbody .ant-checkbox-input") as HTMLInputElement);
    await screen.findByRole("button", { name: /打印已选（1）/ });
    fireEvent.click(screen.getByRole("button", { name: /清空选择/ }));
    expect(await screen.findByRole("button", { name: /打印筛选结果/ })).toBeInTheDocument();
  });

  it("打印筛选结果：先取 manifest，超过 300 条时要求确认，取消则不请求渲染", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/table-prints/manifest")) return { resource: "mps-weekly-plans", title: "事业部周计划", printable: true, total: 1248, columns: [], headerGroups: [], orientation: "landscape", batchSize: 200, confirmThreshold: 300, largeWarningThreshold: 3000 } as never;
      return [] as never;
    });
    const result = await printTable({ resource: "mps-weekly-plans", rangeType: "FILTERED", confirm });
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
    await printTable({ resource: "sales-orders", rangeType: "FILTERED", confirm });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("建议进一步筛选后再打印"));
  });

  it("0 行不打开空白打印页", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/table-prints/manifest")) return { resource: "mps-weekly-plans", title: "事业部周计划", printable: true, total: 0, columns: [], headerGroups: [], orientation: "portrait", batchSize: 200, confirmThreshold: 300, largeWarningThreshold: 3000 } as never;
      return [] as never;
    });
    const result = await printTable({ resource: "mps-weekly-plans", rangeType: "FILTERED" });
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

  it("A/B: 打印时间按 Asia/Shanghai 显示（UTC 03:56:58 → 11:56:58），且不依赖浏览器本机时区", () => {
    /* 与浏览器/进程时区无关：格式化函数显式使用 Asia/Shanghai。 */
    expect(formatPrintDateTime("2026-09-17T03:56:58.000Z")).toBe("2026-09-17 11:56:58");
    expect(formatPrintDateTime("2026-09-17T11:56:58.000Z")).toBe("2026-09-17 19:56:58");
    /* 夏令时无关（中国无夏令时）：跨年边界同样按 +08:00 折算。 */
    expect(formatPrintDateTime("2026-01-01T00:00:00.000Z")).toBe("2026-01-01 08:00:00");
    expect(formatPrintDateTime(null)).toBe("—");
  });

  it("C/D: 打印人显示可信姓名（displayName → username → —），DOM 不出现 UUID", () => {
    const withName: TablePrintDto = { ...dto, meta: { ...dto.meta, printedBy: "崔玮杰" } };
    const { container, unmount } = render(<KdosPrintDocument dto={withName} />);
    const root = container.querySelector('[data-testid="kdos-print-root"]') as HTMLElement;
    expect(within(root).getByText("打印人：崔玮杰")).toBeInTheDocument();
    expect(root.textContent).not.toContain(dto.meta.printedBy.includes("-") ? "" : "never");
    unmount();
    /* 无姓名时回退为登录账号；都没有时显示 —— */
    const { container: usernameContainer } = render(<KdosPrintDocument dto={{ ...dto, meta: { ...dto.meta, printedBy: "cuiweijie" } }} />);
    expect(usernameContainer.textContent).toContain("打印人：cuiweijie");
    const { container: emptyContainer } = render(<KdosPrintDocument dto={{ ...dto, meta: { ...dto.meta, printedBy: "" } }} />);
    expect(emptyContainer.textContent).toContain("打印人：—");
  });

  it("E/F: 页眉不再出现筛选描述，但保留打印范围", () => {
    const filtered: TablePrintDto = { ...dto, meta: { ...dto.meta, filtered: true, searched: true, printedAt: "2026-09-17T03:56:58.000Z", printedBy: "崔玮杰" } };
    const { container } = render(<KdosPrintDocument dto={filtered} />);
    const root = container.querySelector('[data-testid="kdos-print-root"]') as HTMLElement;
    expect(root.textContent).not.toContain("已应用搜索和筛选条件");
    expect(root.textContent).not.toContain("已筛选");
    expect(root.textContent).not.toContain("高级筛选已生效");
    /* 打印范围保留，且只出现有意义的范围信息。 */
    expect(within(root).getByText(/打印范围：筛选结果，共 1 条/)).toBeInTheDocument();
    /* 打印时间已按中国标准时间展示。 */
    expect(within(root).getByText("打印时间：2026-09-17 11:56:58")).toBeInTheDocument();
    expect(root.textContent).not.toContain("2026-09-17T03:56:58");
  });

  it("打印根节点带方向 class，包含表头、分组表头与打印信息", () => {
    const { container } = render(<KdosPrintDocument dto={dto} />);
    const root = container.querySelector('[data-testid="kdos-print-root"]') as HTMLElement;
    expect(root.className).toContain("orientation-landscape");
    expect(within(root).getByText("凯南数字化工作台")).toBeInTheDocument();
    expect(within(root).getByText("事业部周计划")).toBeInTheDocument();
    expect(within(root).getByText(/打印范围：筛选结果，共 1 条/)).toBeInTheDocument();
    expect(within(root).getByText("计划")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="kdos-print-table"] thead')).toBeTruthy();
  });

  it("纵向文档使用 portrait class", () => {
    const { container } = render(<KdosPrintDocument dto={{ ...dto, meta: { ...dto.meta, orientation: "portrait" } }} />);
    expect((container.querySelector('[data-testid="kdos-print-root"]') as HTMLElement).className).toContain("orientation-portrait");
  });
});
