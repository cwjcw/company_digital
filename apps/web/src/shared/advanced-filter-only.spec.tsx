import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";
import { api } from "../api";
import { KdosDataTable } from "./KdosDataTable";

/**
 * KN-TABLE-COLUMN-MENU-001：快速搜索、高级筛选、列头筛选共用同一 FilterGroup。
 * 旧“筛选”抽屉和 Ant 独立排序/漏斗入口仍不存在。
 */
vi.mock("../api", () => ({ api: vi.fn() }));

const fields: TablePermissionFieldDefinition[] = [
  { key: "orderNumber", label: "订单编号", type: "text", editable: true },
  { key: "itemCode", label: "品项编码", type: "text", editable: true },
  { key: "plannedQuantity", label: "计划数量", type: "number", editable: true, format: "decimal" }
];
const columns = [
  { title: "订单编号", dataIndex: "orderNumber", key: "orderNumber", sorter: true },
  { title: "品项编码", dataIndex: "itemCode", key: "itemCode" }
];

function renderTable(resource = "mps-weekly-plans") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queries: Array<Record<string, unknown>> = [];
  const view = render(<QueryClientProvider client={client}>
    <KdosDataTable resource={resource} filterFields={fields} columns={columns} dataSource={[]}
      serverData={{ total: 0, onQueryChange: (query) => queries.push(query as unknown as Record<string, unknown>) }} />
  </QueryClientProvider>);
  return { view, queries };
}

describe("KN-FILTER-002 标准表格只有一套高级筛选入口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "u1", permissions: ["*"] }));
    vi.mocked(api).mockImplementation(async (path: string) => path === "/table-filters/resources"
      ? [{ code: "mps-weekly-plans", filterableFields: fields.map((field) => field.key) }] as never
      : [] as never);
  });
  afterEach(() => cleanup());

  it("A/B: 工具栏只有一个“高级筛选”，不存在旧的“筛选”入口", async () => {
    const { view } = renderTable();
    const toolbar = view.container.querySelector<HTMLElement>(".kdos-data-table-toolbar")!;
    expect(await within(toolbar).findByRole("button", { name: /高级筛选/ })).toBeEnabled();
    expect(within(toolbar).queryByRole("button", { name: /^筛选/ })).not.toBeInTheDocument();
    expect(screen.queryByText("按字段筛选")).not.toBeInTheDocument();
  });

  it("C/D: 列头使用统一菜单，不出现 Ant 原生漏斗", async () => {
    const { view } = renderTable();
    await waitFor(() => expect(view.container.querySelector(".ant-table-thead")).toBeInTheDocument());
    expect(view.container.querySelectorAll(".ant-table-filter-trigger").length).toBe(0);
    expect(view.container.querySelectorAll(".ant-table-filter-dropdown").length).toBe(0);
    expect(screen.getByRole("button", { name: "订单编号列菜单" })).toBeInTheDocument();
  });

  it("E: 高级筛选仍支持添加/删除/ALL/ANY/筛选/清空", async () => {
    const { queries } = renderTable();
    await screen.findByRole("button", { name: /高级筛选/ });
    fireEvent.click(screen.getByRole("button", { name: /高级筛选/ }));
    const panel = document.querySelector('[data-testid="advanced-filter-panel"]') as HTMLElement;
    expect(panel).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: /添加过滤条件/ }));
    expect(within(panel).getAllByText("选择字段").length).toBeGreaterThan(0);
    /* 删除条件 */
    fireEvent.click(within(panel).getByRole("button", { name: "删除条件" }));
    expect(within(panel).queryByText("选择字段")).not.toBeInTheDocument();
    /* ALL / ANY 切换 */
    expect(within(panel).getByText("所有")).toBeInTheDocument();
    /* 清空：写入空的 applied FilterGroup */
    const before = queries.length;
    fireEvent.click(within(panel).getByRole("button", { name: /清\s*空/ }));
    await waitFor(() => expect(queries.length).toBeGreaterThan(before));
    expect(queries.at(-1)?.filterGroup).toEqual({ logic: "AND", rules: [] });
  });

  it("F/G/H: 快速搜索与 FilterGroup 同时下发，且筛选后回到 page=1", async () => {
    const { queries } = renderTable();
    const search = screen.getByPlaceholderText("搜索当前表格");
    fireEvent.change(search, { target: { value: "A001" } });
    await waitFor(() => expect(queries.at(-1)?.search).toBe("A001"));
    /* 翻页后应用筛选条件，必须回到第一页 */
    fireEvent.click(screen.getByRole("button", { name: /高级筛选/ }));
    const panel = document.querySelector('[data-testid="advanced-filter-panel"]') as HTMLElement;
    fireEvent.click(within(panel).getByRole("button", { name: /添加过滤条件/ }));
    fireEvent.mouseDown(within(panel).getAllByText("选择字段")[0]!);
    fireEvent.click(await screen.findByTitle("订单编号"));
    fireEvent.change(within(panel).getByPlaceholderText("输入要匹配的内容"), { target: { value: "A002" } });
    fireEvent.click(within(panel).getByRole("button", { name: /筛\s*选/ }));
    await waitFor(() => {
      const last = queries.at(-1)!;
      expect((last.filterGroup as { rules: unknown[] }).rules.length).toBe(1);
      expect(last.search).toBe("A001");
      expect(last.page).toBe(1);
    });
  });

  it("I: 导出等调用方仍拿到 applied FilterGroup（草稿不进入请求）", async () => {
    const { queries } = renderTable();
    await screen.findByRole("button", { name: /高级筛选/ });
    /* 等首屏查询稳定后再开始计数（服务端查询有 250ms 防抖）。 */
    await waitFor(() => expect(queries.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const before = queries.length;
    fireEvent.click(screen.getByRole("button", { name: /高级筛选/ }));
    const panel = document.querySelector('[data-testid="advanced-filter-panel"]') as HTMLElement;
    fireEvent.click(within(panel).getByRole("button", { name: /添加过滤条件/ }));
    fireEvent.mouseDown(within(panel).getAllByText("选择字段")[0]!);
    fireEvent.click(await screen.findByTitle("品项编码"));
    fireEvent.change(within(panel).getByPlaceholderText("输入要匹配的内容"), { target: { value: "X" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    /* draft 变化不触发新请求 */
    expect(queries.length).toBe(before);
    fireEvent.click(within(panel).getByRole("button", { name: /筛\s*选/ }));
    await waitFor(() => expect(queries.length).toBeGreaterThan(before));
    const rules = (queries.at(-1)!.filterGroup as { rules: Array<{ field: string }> }).rules;
    expect(rules[0]!.field).toBe("itemCode");
  });

  it("排序只通过列菜单，执行后回到第一页", async () => {
    const { view, queries } = renderTable();
    await waitFor(() => expect(view.container.querySelector(".ant-table-thead")).toBeInTheDocument());
    expect(view.container.querySelector(".ant-table-column-sorters")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "订单编号列菜单" }));
    fireEvent.click(screen.getByRole("button", { name: /升序/ }));
    await waitFor(() => expect(queries.at(-1)).toEqual(expect.objectContaining({ sortField: "orderNumber", sortOrder: "asc", page: 1 })));
    fireEvent.click(screen.getByRole("button", { name: "订单编号列菜单" }));
    fireEvent.click(screen.getByRole("button", { name: /降序/ }));
    await waitFor(() => expect(queries.at(-1)).toEqual(expect.objectContaining({ sortField: "orderNumber", sortOrder: "desc", page: 1 })));
  });

  it("列头多选和未填写形成同字段 OR，候选从服务端获取且排除自身筛选", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => path === "/table-filters/resources"
      ? [{ code: "mps-weekly-plans", filterableFields: fields.map((field) => field.key) }] as never
      : path.startsWith("/table-filters/candidates?") ? { options: [{ value: "A", label: "A" }, { value: "B", label: "B" }], hasMore: false } as never : [] as never);
    const { queries } = renderTable();
    fireEvent.click(screen.getByRole("button", { name: "订单编号列菜单" }));
    const panel = await screen.findByTestId("column-menu-orderNumber");
    await waitFor(() => expect(within(panel).getByRole("button", { name: /筛选/ })).toBeEnabled());
    fireEvent.click(within(panel).getByRole("button", { name: /筛选/ }));
    await waitFor(() => expect(within(panel).getByText("A")).toBeInTheDocument());
    fireEvent.click(within(panel).getByText("A"));
    fireEvent.click(within(panel).getByText("未填写"));
    fireEvent.click(within(panel).getByRole("button", { name: /确\s*定/ }));
    await waitFor(() => expect(queries.at(-1)?.filterGroup).toMatchObject({ logic: "AND", groups: [
      { logic: "AND", rules: [] }, { logic: "AND", groups: [{ logic: "OR", rules: [
        { field: "orderNumber", operator: "in", values: ["A"] }, { field: "orderNumber", operator: "is_empty" }
      ] }] }
    ] }));
    fireEvent.click(screen.getByRole("button", { name: "订单编号列菜单" }));
    fireEvent.click(within(panel).getByRole("button", { name: /筛选/ }));
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path]) => String(path).includes("currentHeaderField=orderNumber"))).toBe(true));
  });

  it("高基数未加载完整候选时禁用全选，simple 表不显示列菜单", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => path === "/table-filters/resources"
      ? [{ code: "mps-weekly-plans", filterableFields: fields.map((field) => field.key) }] as never
      : path.startsWith("/table-filters/candidates?") ? { options: [{ value: "A", label: "A" }], hasMore: true } as never : [] as never);
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "订单编号列菜单" }));
    const panel = await screen.findByTestId("column-menu-orderNumber");
    await waitFor(() => expect(within(panel).getByRole("button", { name: /筛选/ })).toBeEnabled());
    fireEvent.click(within(panel).getByRole("button", { name: /筛选/ }));
    await waitFor(() => expect(within(panel).getByText("候选值较多，请输入关键词搜索")).toBeInTheDocument());
    expect(within(panel).getByRole("checkbox", { name: "全选" })).toBeDisabled();
  });

  it("冻结/隐藏写入当前用户个人视图，隐藏后取消用户冻结", async () => {
    renderTable();
    const trigger = screen.getByRole("button", { name: "订单编号列菜单" });
    expect(trigger.getAttribute("tabindex")).not.toBe("-1");
    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    const panel = await screen.findByTestId("column-menu-orderNumber");
    fireEvent.click(within(panel).getByRole("button", { name: /冻结到左侧/ }));
    expect(JSON.parse(localStorage.getItem("kdos-form-pinned:u1:mps-weekly-plans") ?? "[]")).toContain("orderNumber");
    fireEvent.click(screen.getByRole("button", { name: "订单编号列菜单" }));
    fireEvent.click(within(panel).getByRole("button", { name: "隐藏此列" }));
    expect(JSON.parse(localStorage.getItem("kdos-form-pinned:u1:mps-weekly-plans") ?? "[]")).not.toContain("orderNumber");
    expect(screen.queryByRole("button", { name: "订单编号列菜单" })).not.toBeInTheDocument();
  });
});
