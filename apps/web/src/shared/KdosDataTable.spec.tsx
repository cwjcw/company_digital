import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App as AntApp } from "antd";
import { api } from "../api";
import { displayedExportKeys, KdosDataTable, orderKdosFixedColumns } from "./KdosDataTable";
import { tablePreferenceQueryKey } from "./table-preferences";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

vi.mock("../api", () => ({ api: vi.fn() }));
const savedPreferences = new Map<string, unknown>();
const prefKey = (resource: string, viewKey: string | undefined, type: string) => `${resource}:${viewKey ?? ""}:${type}`;
function mockExportDownload() {
  class TestUrl extends URL {}
  Object.assign(TestUrl, { createObjectURL: vi.fn().mockReturnValue("blob:test-export"), revokeObjectURL: vi.fn() });
  vi.stubGlobal("URL", TestUrl);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
}

describe("KdosDataTable server pagination", () => {
  it("导出沿用最终列树顺序，保留分组子列和展示别名，排除操作列", () => {
    expect(displayedExportKeys([
      { key: "orderNumber", dataIndex: "orderNumber" },
      { title: "工序", children: [{ key: "weldingStatus", dataIndex: "weldingStatus" }, { key: "packagingStatus", dataIndex: "packagingStatus" }] },
      { key: "salespersonNames", exportFieldKey: "salespersonUserIds" } as never,
      { key: "__actions" }, { key: "createdAt", dataIndex: "createdAt" }
    ])).toEqual(["orderNumber", "weldingStatus", "packagingStatus", "salespersonUserIds", "createdAt"]);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    savedPreferences.clear();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "table-user", tenantId: "KAINAN", permissions: ["*"] }));
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/auth/preferences/table-config" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)); const key = prefKey(body.resource, body.viewKey, body.configType);
        if (body.config === null) savedPreferences.delete(key); else savedPreferences.set(key, body.config);
        return { config: body.config, reset: body.config === null } as never;
      }
      if (path.startsWith("/auth/preferences/table-config?")) {
        const params = new URL(path, "http://local").searchParams;
        const user = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
        return { config: user.sub === "user-b" ? null : savedPreferences.get(prefKey(params.get("resource") ?? "", params.get("viewKey") ?? undefined, params.get("configType") ?? "")) ?? null } as never;
      }
      return [] as never;
    });
  });

  it("uses short themed edit/exit buttons without changing permissions or triggering saves", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const element = () => <QueryClientProvider client={client}><KdosDataTable resource="equipment-register" editable
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[{ id: "1", equipmentCode: "A001" }]} /></QueryClientProvider>;
    const view = render(element());
    await screen.findByText("A001");
    const edit = screen.getByRole("button", { name: "进入编辑模式" });
    expect(edit).toHaveTextContent(/^编辑$/);
    expect(edit).toHaveAttribute("aria-pressed", "false");
    expect(edit).toHaveClass("ant-btn-color-primary", "ant-btn-variant-outlined");
    expect(edit.querySelector('[aria-label="edit"]')).not.toBeNull();
    fireEvent.click(edit);
    const exit = screen.getByRole("button", { name: "退出编辑模式" });
    expect(exit).toHaveTextContent(/^退出$/);
    expect(exit).toHaveAttribute("aria-pressed", "true");
    expect(exit).toHaveClass("ant-btn-color-primary", "ant-btn-variant-solid");
    expect(exit.querySelector('[aria-label="logout"]')).not.toBeNull();
    expect(view.container.querySelector('[data-edit-mode="editing"]')).not.toBeNull();
    fireEvent.click(exit);
    expect(view.container.querySelector('[data-edit-mode="readonly"]')).not.toBeNull();
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method && init.method !== "GET")).toBe(false);

    localStorage.setItem("sessionUser", JSON.stringify({ sub: "table-user", tenantId: "KAINAN", permissions: ["equipment-register:*:read"] }));
    view.rerender(element());
    expect(screen.queryByRole("button", { name: /进入编辑模式|退出编辑模式/ })).toBeNull();
  });

  it("keeps the requested page instead of resetting a pagination action to page one", async () => {
    const onQueryChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}>
      <KdosDataTable
        resource="equipment-register"
        rowKey="id"
        columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]}
        dataSource={[{ id: "asset-1", equipmentCode: "A001" }]}
        serverData={{ total: 120, onQueryChange }}
      />
    </QueryClientProvider>);

    await waitFor(() => expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 100 })));
    onQueryChange.mockClear();
    fireEvent.click(view.container.querySelector(".ant-pagination-item-2")!);

    await waitFor(() => expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 100 })));
    expect(view.container.querySelector(".ant-pagination-item-2")).toHaveClass("ant-pagination-item-active");
  });

  it("keeps an explicit page size instead of replacing it with the platform default", async () => {
    const onQueryChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id"
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[]} serverData={{ total: 0, onQueryChange }}
      pagination={{ pageSize: 50 }} /></QueryClientProvider>);
    await waitFor(() => expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50 })));
  });

  it("simple 汇总表不显示搜索、高级筛选、字段显示或列菜单", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><KdosDataTable simple resource="equipment-register" systemFields={false}
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[{ id: "1", equipmentCode: "A001" }]} /></QueryClientProvider>);
    expect(screen.queryByRole("button", { name: "设备编号列菜单" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("搜索当前表格")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /字段显示/ })).not.toBeInTheDocument();
  });

  it("首次默认显示全部获权业务字段，字段失权后立即从表格与选择器移除", async () => {
    const fields = [
      { key: "orderNumber", label: "订单编号", type: "text" as const, editable: false },
      { key: "itemName", label: "品项", type: "text" as const, editable: false },
      { key: "secretCode", label: "内部编码", type: "text" as const, editable: false }
    ];
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "field-user", tenantId: "KAINAN", permissions: [
      "mps-group-plans:orderNumber:read", "mps-group-plans:itemName:read"
    ] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const columns = fields.map(field => ({ title: field.label, dataIndex: field.key }));
    const element = (onQueryChange = vi.fn()) => <QueryClientProvider client={client}><KdosDataTable resource="mps-group-plans" rowKey="id"
      filterFields={fields} columns={columns} dataSource={[{ id: "1", orderNumber: "A1", itemName: "桌脚", secretCode: "S1" }]}
      serverData={{ total: 1, onQueryChange }} /></QueryClientProvider>;
    const view = render(element());
    await screen.findByText("A1");
    expect(screen.getByText("桌脚")).toBeInTheDocument();
    expect(screen.queryByText("S1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /字段显示/ }));
    expect(await screen.findByRole("checkbox", { name: "订单编号" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "品项" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "内部编码" })).not.toBeInTheDocument();

    localStorage.setItem("sessionUser", JSON.stringify({ sub: "field-user", tenantId: "KAINAN", permissions: ["mps-group-plans:orderNumber:read"] }));
    view.rerender(element());
    await waitFor(() => expect(view.container.querySelector('th[data-kdos-column-key="itemName"]')).toBeNull());
    expect(screen.queryByRole("checkbox", { name: "品项" })).not.toBeInTheDocument();
  });

  it("个人设置加载失败时只回退到当前获权字段并显示说明", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/auth/preferences/table-config?")) throw Object.assign(new Error("无权限"), { status: 403 });
      return [] as never;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id"
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[{ id: "1", equipmentCode: "A001" }]} /></QueryClientProvider>);
    expect(await view.findByText("A001")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /字段显示/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("当前暂用全部有权限字段");
    expect(screen.getByRole("alert")).toHaveTextContent("HTTP 403");
    expect(screen.getByRole("button", { name: "保存我的设置" })).toBeDisabled();
  });

  it("页面往返和多个表格实例复用同一用户的有效偏好缓存", async () => {
    const client = new QueryClient();
    const table = <QueryClientProvider client={client}><KdosDataTable resource="equipment-register"
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[{ id: "1", equipmentCode: "A001" }]} /></QueryClientProvider>;
    const first = render(table);
    await screen.findByText("A001");
    first.unmount();
    render(table);
    await screen.findByText("A001");
    const gets = () => vi.mocked(api).mock.calls.filter(([path]) => path.startsWith("/auth/preferences/table-config?"));
    expect(gets()).toHaveLength(1);
    render(table);
    await waitFor(() => expect(screen.getAllByText("A001")).toHaveLength(2));
    expect(gets()).toHaveLength(1);
  });

  it.each([false, true])("后台读取失败与恢复保留已有布局，未保存调整=%s", async (dirty) => {
    savedPreferences.set(prefKey("equipment-register", undefined, "DISPLAY"), {
      version: 1, visibleFieldKeys: dirty ? ["equipmentCode", "equipmentName"] : ["equipmentCode"],
      orderedFieldKeys: ["equipmentCode", "equipmentName"], columnWidths: { equipmentCode: 240 }, pinnedFieldKeys: []
    });
    const original = vi.mocked(api).getMockImplementation()!;
    let failed = false;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (failed && path.startsWith("/auth/preferences/table-config?")) throw Object.assign(new Error("forbidden"), { status: 403 });
      return original(path, init);
    });
    const client = new QueryClient();
    const view = render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register"
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }, { title: "设备名称", dataIndex: "equipmentName" }]}
      dataSource={[{ id: "1", equipmentCode: "A001", equipmentName: "设备甲" }]} /></QueryClientProvider>);
    await screen.findByText("A001");
    fireEvent.click(screen.getByRole("button", { name: /字段显示/ }));
    if (dirty) fireEvent.click(await screen.findByRole("checkbox", { name: "设备名称" }));
    failed = true;
    await act(async () => { await client.refetchQueries({ queryKey: tablePreferenceQueryKey("equipment-register", undefined, "DISPLAY"), exact: true }); });
    await waitFor(() => expect(screen.getByRole("alert", { hidden: true })).toHaveTextContent("继续使用已加载的个人布局"));
    expect(view.container.querySelector('th[data-kdos-column-key="equipmentName"]')).toBeNull();
    expect(view.container.querySelector('th[data-kdos-column-key="equipmentCode"]')).toHaveAttribute("data-kdos-column-width", "240");
    expect(screen.getByRole("button", { name: "保存我的设置" })).toBeDisabled();
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "重新加载个人设置", hidden: true }));
    await waitFor(() => expect(screen.queryByRole("alert", { hidden: true })).not.toBeInTheDocument());
    expect(view.container.querySelector('th[data-kdos-column-key="equipmentName"]')).toBeNull();
    if (dirty) expect(screen.getByRole("button", { name: "保存我的设置" })).toBeEnabled();
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("个人布局只影响当前用户；被隐藏的待报工输入字段仍留在个人字段选择器中", async () => {
    savedPreferences.set(prefKey("mps-process-reports", "PENDING", "DISPLAY"), {
      version: 1, visibleFieldKeys: ["orderNumber"], orderedFieldKeys: ["orderNumber", "productionQuantity"], columnWidths: {}, pinnedFieldKeys: []
    });
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "report-user", tenantId: "KAINAN", permissions: ["*"] }));
    const fields = [
      { key: "orderNumber", label: "订单编号", type: "text" as const, editable: false },
      { key: "productionQuantity", label: "本次报工数量", type: "number" as const, editable: true }
    ];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><KdosDataTable resource="mps-process-reports" viewKey="PENDING"
      rowKey="id" filterFields={fields} advancedFilterFields={[fields[0]!]}
      columns={fields.map(field => ({ title: field.label, dataIndex: field.key }))}
      dataSource={[{ id: "task-1", orderNumber: "SO-1", productionQuantity: 10 }]} /></QueryClientProvider>);

    await screen.findByText("SO-1");
    expect(view.container.querySelector('th[data-kdos-column-key="productionQuantity"]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /字段显示/ }));
    const quantityField = await screen.findByRole("checkbox", { name: "本次报工数量" });
    expect(quantityField).not.toBeChecked();
    fireEvent.click(quantityField);
    fireEvent.click(screen.getByRole("button", { name: "保存我的设置" }));
    await waitFor(() => {
      const put = vi.mocked(api).mock.calls.find(([path, init]) => path === "/auth/preferences/table-config" && init?.method === "PUT");
      expect(put).toBeDefined();
      expect(JSON.parse(String(put?.[1]?.body)).config.visibleFieldKeys).toContain("productionQuantity");
    });
    expect(view.container.querySelector('th[data-kdos-column-key="productionQuantity"]')).toBeInTheDocument();
  });

  it("标准模式只保留横向滚动，内部纵向滚动必须显式开启", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const standard = render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id"
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[{ id: "1", equipmentCode: "A001" }]}
      scroll={{ x: "max-content", y: 240 }} /></QueryClientProvider>);
    expect(standard.container.querySelector(".ant-table-body")).toHaveStyle({ overflowY: "hidden" });
    expect(standard.container.querySelector(".ant-table-body")).toHaveStyle({ overflowX: "auto" });
    expect(standard.container.querySelector(".ant-table-sticky-holder")).toHaveStyle({ top: "0px" });

    standard.unmount();
    render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id" internalVerticalScroll
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[{ id: "1", equipmentCode: "A001" }]}
      scroll={{ x: "max-content", y: 240 }} /></QueryClientProvider>);
    expect(document.querySelector(".ant-table-body")?.getAttribute("style")).toMatch(/overflow-y: (auto|scroll)/);
  });

  it("compact density is the standard default and explicit default remains available", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const standard = render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id"
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[{ id: "1", equipmentCode: "A001" }]} /></QueryClientProvider>);
    expect(standard.container.querySelector("section")).toHaveClass("kdos-data-table-shell-compact");
    expect(standard.container.querySelector("section")?.getAttribute("data-density")).toBe("compact");
    standard.unmount();
    const explicitDefault = render(<QueryClientProvider client={client}><KdosDataTable density="default" resource="mps-weekly-plans" rowKey="id"
      columns={[{ title: "订单编号", dataIndex: "orderNumber" }]} dataSource={[{ id: "1", orderNumber: "A001" }]} /></QueryClientProvider>);
    expect(explicitDefault.container.querySelector("section")).not.toHaveClass("kdos-data-table-shell-compact");
    expect(explicitDefault.container.querySelector("section")?.getAttribute("data-density")).toBe("default");
  });

  it("最终列模型按 left + normal + right 稳定分组，并保持多个固定列的相对顺序", () => {
    const ordered = orderKdosFixedColumns([
      { title: "普通甲", key: "normal-a" },
      { title: "右甲", key: "right-a", fixed: "right" },
      { title: "左甲", key: "left-a", fixed: "left" },
      { title: "普通乙", key: "normal-b" },
      { title: "右乙", key: "right-b", fixed: "right" },
      { title: "左乙", key: "left-b", fixed: "left" }
    ]);
    expect(ordered.map((column) => String(column.key))).toEqual([
      "left-a", "left-b", "normal-a", "normal-b", "right-a", "right-b"
    ]);
  });

  it("审计列追加和个人视图处理后，右固定操作列仍是最终最右列", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id"
      columns={[
        { title: "设备名称", dataIndex: "equipmentName" },
        { title: "左固定", key: "__left", width: 52, fixed: "left", className: "test-left-column" },
        { title: "右操作甲", key: "__rightA", width: 52, fixed: "right", className: "test-right-a" },
        { title: "右操作乙", key: "__rightB", width: 52, fixed: "right", className: "test-right-b" }
      ]} dataSource={[{ id: "1", equipmentName: "设备一" }]} scroll={{ x: "max-content" }} /></QueryClientProvider>);
    await waitFor(() => expect(view.container.querySelector('th[data-kdos-column-key="equipmentName"]')).toBeInTheDocument());

    const headers = Array.from(view.container.querySelectorAll(".ant-table-thead th"));
    const labels = headers.map((header) => header.textContent?.trim() ?? "");
    expect(labels.indexOf("左固定")).toBeLessThan(labels.indexOf("设备名称"));
    expect(labels.indexOf("创建人")).toBeLessThan(labels.indexOf("右操作甲"));
    expect(labels.indexOf("更新时间")).toBeLessThan(labels.indexOf("右操作甲"));
    expect(labels.slice(-2)).toEqual(["右操作甲", "右操作乙"]);
    expect(headers.at(-2)).toHaveClass("ant-table-cell-fix-right");
    expect(headers.at(-1)).toHaveClass("ant-table-cell-fix-right");
    expect(view.container.querySelector(".ant-table-body")).toHaveStyle({ overflowX: "auto" });
    expect(view.container.querySelector(".ant-table-sticky-holder")).toHaveStyle({ top: "0px" });
  });

  it("个人视图隐藏审计列后，技术操作列仍保留并位于最终可见列最右端", async () => {
    savedPreferences.set(prefKey("equipment-register", undefined, "DISPLAY"), { version: 1, visibleFieldKeys: ["equipmentName"], orderedFieldKeys: ["equipmentName"], columnWidths: {}, pinnedFieldKeys: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id"
      columns={[
        { title: "设备名称", dataIndex: "equipmentName" },
        { title: "", key: "__rowActions", width: 52, fixed: "right", className: "test-row-actions" }
      ]} dataSource={[{ id: "1", equipmentName: "设备一" }]} /></QueryClientProvider>);
    await waitFor(() => expect(view.container.querySelector('th[data-kdos-column-key="equipmentName"]')).toBeInTheDocument());
    const headers = Array.from(view.container.querySelectorAll(".ant-table-thead th"));
    expect(headers.some((header) => header.textContent?.includes("创建人"))).toBe(false);
    expect(headers.at(-1)).toHaveClass("test-row-actions", "ant-table-cell-fix-right");
  });

  it("技术操作列尊重 52px 显式宽度；未注册字段不进入获权业务列", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id" systemFields={false}
      columns={[
        { title: "设备编号", dataIndex: "equipmentCode", width: 40 },
        { title: "未注册业务字段", dataIndex: "unregisteredBusinessField", width: 40 },
        { title: "", key: "__rowActions", width: 52, fixed: "right", className: "test-row-actions" }
      ]} dataSource={[{ id: "1", equipmentCode: "A001", unregisteredBusinessField: "业务值" }]} /></QueryClientProvider>);
    await waitFor(() => expect(view.container.querySelector('th[data-kdos-column-key="equipmentCode"]')).toBeInTheDocument());
    const headers = Array.from(view.container.querySelectorAll(".ant-table-thead th"));
    const columns = Array.from(view.container.querySelectorAll(".ant-table colgroup col"));
    const businessIndex = headers.findIndex((header) => header.textContent?.includes("设备编号"));
    const unregisteredBusinessIndex = headers.findIndex((header) => header.textContent?.includes("未注册业务字段"));
    const actionIndex = headers.findIndex((header) => header.classList.contains("test-row-actions"));
    expect(businessIndex).toBeGreaterThanOrEqual(0);
    expect(unregisteredBusinessIndex).toBe(-1);
    expect(actionIndex).toBeGreaterThanOrEqual(0);
    expect((columns[businessIndex] as HTMLElement | undefined)?.style.width).toBe("96px");
    expect((columns[actionIndex] as HTMLElement | undefined)?.style.width).toBe("52px");
    expect((columns[actionIndex] as HTMLElement | undefined)?.style.minWidth).toBe("52px");
  });

  it("标准表支持拖动列宽，修改即时生效但必须显式保存", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-a", tenantCode: "TENANT-A", permissions: ["*"] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id"
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[{ id: "1", equipmentCode: "A001" }]} /></QueryClientProvider>);
    await screen.findByTestId("kdos-column-resizer-equipmentCode");
    const header = view.container.querySelector('th[data-kdos-column-key="equipmentCode"]');
    expect(header?.getAttribute("data-kdos-column-width")).toBe("120");
    fireEvent.mouseDown(await screen.findByTestId("kdos-column-resizer-equipmentCode"), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 220 });
    fireEvent.mouseUp(window);
    await waitFor(() => expect(header?.getAttribute("data-kdos-column-width")).toBe("240"));
    expect(screen.getByRole("button", { name: /未保存/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /字段显示/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存我的设置" }));
    await waitFor(() => expect(savedPreferences.get(prefKey("equipment-register", undefined, "DISPLAY"))).toMatchObject({ columnWidths: { equipmentCode: 240 } }));

    cleanup();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-b", tenantCode: "TENANT-A", permissions: ["*"] }));
    const otherUser = render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id"
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]} dataSource={[{ id: "1", equipmentCode: "A001" }]} /></QueryClientProvider>);
    await waitFor(() => expect(otherUser.container.querySelector('th[data-kdos-column-key="equipmentCode"]')?.getAttribute("data-kdos-column-width")).toBe("120"));
  });

  it("用户宽度覆盖业务初始宽度，隐藏后重新显示仍可恢复", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-a", tenantCode: "TENANT-A", permissions: ["*"] }));
    savedPreferences.set(prefKey("mps-group-plans", undefined, "DISPLAY"), { version: 1, visibleFieldKeys: ["orderNumber", "itemName"], orderedFieldKeys: ["itemName", "orderNumber"], columnWidths: { orderNumber: 260 }, pinnedFieldKeys: ["orderNumber"] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><KdosDataTable resource="mps-group-plans" rowKey="id"
      columns={[{ title: "订单编号", dataIndex: "orderNumber" }, { title: "品项", dataIndex: "itemName" }]}
      dataSource={[{ id: "1", orderNumber: "A001", itemName: "品项" }]} /></QueryClientProvider>);
    await screen.findByTestId("kdos-column-resizer-orderNumber");
    expect(view.container.querySelector('th[data-kdos-column-key="orderNumber"]')?.getAttribute("data-kdos-column-width")).toBe("260");
    expect(view.container.querySelector('th[data-kdos-column-key="orderNumber"]')).toHaveClass("ant-table-cell-fix-left");
    fireEvent.click(screen.getByRole("button", { name: /字段显示/ }));
    const orderCheckbox = await screen.findByRole("checkbox", { name: "订单编号" });
    fireEvent.click(orderCheckbox);
    fireEvent.click(orderCheckbox);
    await waitFor(() => expect(view.container.querySelector('th[data-kdos-column-key="orderNumber"]')?.getAttribute("data-kdos-column-width")).toBe("260"));
  });

  it("allows stable record selection in browse mode and clears it explicitly", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "viewer", permissions: ["mps-group-plans:*:read", "mps-group-plans:orderNumber:read"] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}>
      <KdosDataTable resource="mps-group-plans" rowKey="id" columns={[{ title: "订单编号", dataIndex: "orderNumber" }]}
        dataSource={[{ id: "stable-a", orderNumber: "A" }, { id: "stable-b", orderNumber: "B" }]} serverData={{ total: 12, onQueryChange: vi.fn() }} />
    </QueryClientProvider>);

    await screen.findByText("A");
    const rowCheckboxes = view.container.querySelectorAll("tbody tr input[type=checkbox]");
    expect(rowCheckboxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(rowCheckboxes[rowCheckboxes.length - 1]!);
    expect(await view.findByText("已选 1/12")).toBeInTheDocument();
    expect(view.container.querySelector("section")?.getAttribute("data-edit-mode")).toBe("readonly");
    fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
    await waitFor(() => expect(screen.queryByText("已选 1/12")).not.toBeInTheDocument());
  });

  it("selects only the current page and preserves explicit selections across pages", async () => {
    const onQueryChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = { resource: "mps-group-plans", rowKey: "id" as const, columns: [{ title: "订单编号", dataIndex: "orderNumber" }], serverData: { total: 120, onQueryChange } };
    const view = render(<QueryClientProvider client={client}><KdosDataTable {...props}
      dataSource={[{ id: "page-1-a", orderNumber: "A" }, { id: "page-1-b", orderNumber: "B" }]} /></QueryClientProvider>);

    await screen.findByText("A");
    const firstPageCheckboxes = view.container.querySelectorAll("tbody tr input[type=checkbox]");
    fireEvent.click(firstPageCheckboxes[firstPageCheckboxes.length - 2]!);
    fireEvent.click(firstPageCheckboxes[firstPageCheckboxes.length - 1]!);
    expect(await view.findByText("已选 2/120")).toBeInTheDocument();
    fireEvent.click(view.container.querySelector(".ant-pagination-item-2")!);
    view.rerender(<QueryClientProvider client={client}><KdosDataTable {...props}
      dataSource={[{ id: "page-2-a", orderNumber: "C" }, { id: "page-2-b", orderNumber: "D" }]} /></QueryClientProvider>);
    const secondPageCheckboxes = view.container.querySelectorAll("tbody tr input[type=checkbox]");
    fireEvent.click(secondPageCheckboxes[secondPageCheckboxes.length - 1]!);
    expect(await view.findByText("已选 3/120")).toBeInTheDocument();
    expect(Array.from(secondPageCheckboxes).filter((node) => (node as HTMLInputElement).checked)).toHaveLength(1);
  });

  it("shows the standard top delete only with permission and keeps it disabled until selection", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      resource: "equipment-register", rowKey: "id" as const,
      columns: [{ title: "设备编号", dataIndex: "equipmentCode" }],
      dataSource: [{ id: "asset-1", equipmentCode: "A001", canDelete: true }]
    };
    const view = render(<AntApp><QueryClientProvider client={client}><KdosDataTable {...props}
      deleteAction={{ permitted: false, onDelete: vi.fn() }} /></QueryClientProvider></AntApp>);
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();

    view.rerender(<AntApp><QueryClientProvider client={client}><KdosDataTable {...props}
      deleteAction={{ permitted: true, canDelete: (row) => row.canDelete, onDelete: vi.fn() }} /></QueryClientProvider></AntApp>);
    const button = await screen.findByRole("button", { name: "删除" });
    expect(button).toBeDisabled();
    await screen.findByText("A001");
    const rowCheckboxes = view.container.querySelectorAll("tbody tr input[type=checkbox]");
    fireEvent.click(rowCheckboxes[rowCheckboxes.length - 1]!);
    expect(button).toBeEnabled();
    expect(view.container.querySelector("section")?.getAttribute("data-edit-mode")).toBe("readonly");
  });

  it("blocks the whole delete when any selected row has canDelete=false", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<AntApp><QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id"
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]}
      dataSource={[{ id: "asset-1", equipmentCode: "A001", canDelete: true }, { id: "asset-2", equipmentCode: "A002", canDelete: false }]}
      deleteAction={{ permitted: true, canDelete: (row) => row.canDelete, onDelete: vi.fn() }} />
    </QueryClientProvider></AntApp>);
    await screen.findByText("A001");
    const rowCheckboxes = view.container.querySelectorAll("tbody tr input[type=checkbox]");
    fireEvent.click(rowCheckboxes[rowCheckboxes.length - 2]!);
    expect(screen.getByRole("button", { name: "删除" })).toBeEnabled();
    fireEvent.click(rowCheckboxes[rowCheckboxes.length - 1]!);
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除" })).toHaveAttribute("title", "选中记录中包含无删除权限的数据");
  });

  it("confirms the selected count, calls the formal delete callback, and clears successful selection", async () => {
    const onDelete = vi.fn(async () => undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<AntApp><QueryClientProvider client={client}><KdosDataTable resource="equipment-register" rowKey="id"
      columns={[{ title: "设备编号", dataIndex: "equipmentCode" }]}
      dataSource={[{ id: "asset-1", equipmentCode: "A001", canDelete: true }]}
      deleteAction={{ permitted: true, canDelete: (row) => row.canDelete, onDelete }} />
    </QueryClientProvider></AntApp>);
    await screen.findByText("A001");
    const rowCheckboxes = view.container.querySelectorAll("tbody tr input[type=checkbox]");
    fireEvent.click(rowCheckboxes[rowCheckboxes.length - 1]!);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog", { name: "确认删除选中的 1 条数据？" });
    fireEvent.click(dialog.querySelector(".ant-modal-confirm-btns .ant-btn-primary")!);
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith([expect.objectContaining({ id: "asset-1" })]));
    await waitFor(() => expect(screen.queryByText("已选 1/1")).not.toBeInTheDocument());
  });

  it("仅在服务端返回 export 权限时显示标准导出按钮", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "exporter", permissions: ["mps-group-plans:*:read", "mps-group-plans:*:export"] }));
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/table-exports/capabilities") return [{ code: "mps-group-plans", supported: true, allowed: true }] as never;
      if (path === "/table-filters/resources") return [] as never;
      return [] as never;
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <KdosDataTable resource="mps-group-plans" columns={[{ title: "订单编号", dataIndex: "orderNumber" }]} dataSource={[]} />
    </QueryClientProvider>);
    expect(await screen.findByRole("button", { name: /导出/ })).toBeInTheDocument();
  });

  it("没有服务端 export 权限时不显示导出按钮", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "viewer", permissions: ["mps-group-plans:*:read", "mps-group-plans:orderNumber:read"] }));
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/table-exports/capabilities") return [{ code: "mps-group-plans", supported: true, allowed: false }] as never;
      if (path === "/table-filters/resources") return [] as never;
      return [] as never;
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <KdosDataTable resource="mps-group-plans" columns={[{ title: "订单编号", dataIndex: "orderNumber" }]} dataSource={[]} />
    </QueryClientProvider>);
    await waitFor(() => expect(screen.queryByRole("button", { name: "导出" })).not.toBeInTheDocument());
  });

  it("零选中时单一导出入口标明当前视图并沿用筛选结果模式", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "exporter", permissions: ["mps-group-plans:*:read", "mps-group-plans:*:export", "*"] }));
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/table-exports/capabilities") return [{ code: "mps-group-plans", supported: true, allowed: true }] as never;
      if (path === "/table-filters/resources") return [] as never;
      if (path.startsWith("/table-exports/mps-group-plans?")) return new Blob(["xlsx"]) as never;
      return [] as never;
    });
    mockExportDownload();
    render(<AntApp><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <KdosDataTable resource="mps-group-plans" columns={[{ title: "订单编号", dataIndex: "orderNumber" }]}
        dataSource={[{ id: "row-1", orderNumber: "A" }, { id: "row-2", orderNumber: "B" }]} />
    </QueryClientProvider></AntApp>);
    await screen.findByText("A");
    fireEvent.click(await screen.findByRole("button", { name: /导出当前视图/ }));
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path]) => String(path).includes("rangeType=FILTERED"))).toBe(true), { timeout: 1500 });
    const exportRequests = vi.mocked(api).mock.calls.filter(([path]) => String(path).startsWith("/table-exports/mps-group-plans?")).map(([path]) => String(path));
    const request = exportRequests[exportRequests.length - 1] ?? "";
    expect(request).toContain("rangeType=FILTERED");
    expect(request).not.toContain("selectedIds=");
  });

  it("单一导出入口跨页保留所选ID，确认后只导出已选记录和当前可见列", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "exporter", permissions: ["*"] }));
    savedPreferences.set(prefKey("mps-group-plans", undefined, "DISPLAY"), {
      version: 1, visibleFieldKeys: ["orderNumber"], orderedFieldKeys: ["orderNumber", "itemName"], columnWidths: {}, pinnedFieldKeys: []
    });
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/table-exports/capabilities") return [{ code: "mps-group-plans", supported: true, allowed: true }] as never;
      if (path === "/table-filters/resources") return [] as never;
      if (path === "/table-exports/mps-group-plans") return new Blob(["xlsx"]) as never;
      return [] as never;
    });
    mockExportDownload();
    const onQueryChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = { resource: "mps-group-plans", rowKey: "id" as const,
      columns: [{ title: "订单编号", dataIndex: "orderNumber" }, { title: "品项名称", dataIndex: "itemName" }],
      serverData: { total: 120, onQueryChange } };
    const view = render(<AntApp><QueryClientProvider client={client}><KdosDataTable {...props}
      dataSource={[{ id: "11111111-1111-4111-8111-111111111111", orderNumber: "A", itemName: "hidden-A" }]} /></QueryClientProvider></AntApp>);
    await screen.findByText("A");
    await screen.findByText("共 120 条");
    const firstRow = view.container.querySelector('tr:has(td)')!;
    fireEvent.click(firstRow.querySelector('input[type="checkbox"]')!);
    fireEvent.click(await screen.findByRole("button", { name: /导出已选（1）/ }));
    const singleDialog = await screen.findByRole("dialog", { name: "确认导出已选记录" });
    fireEvent.click(singleDialog.querySelector(".ant-modal-confirm-btns .ant-btn-primary")!);
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path, init]) => String(path) === "/table-exports/mps-group-plans" && String(init?.body).includes("11111111-1111-4111-8111-111111111111"))).toBe(true));
    fireEvent.click(view.container.querySelector(".ant-pagination-item-2")!);
    view.rerender(<AntApp><QueryClientProvider client={client}><KdosDataTable {...props}
      dataSource={[{ id: "22222222-2222-4222-8222-222222222222", orderNumber: "B", itemName: "hidden-B" }]} /></QueryClientProvider></AntApp>);
    await screen.findByText("B");
    const secondRow = view.container.querySelector('tr:has(td)')!;
    fireEvent.click(secondRow.querySelector('input[type="checkbox"]')!);
    const exportButton = await screen.findByRole("button", { name: /导出已选（2）/ });
    fireEvent.click(exportButton);
    const dialog = await screen.findByRole("dialog", { name: "确认导出已选记录" });
    expect(dialog).toHaveTextContent("本次仅导出已选中的 2 条记录；当前筛选结果中的未选记录不会导出。");
    fireEvent.click(dialog.querySelector(".ant-modal-confirm-btns .ant-btn-primary")!);
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path, init]) => String(path) === "/table-exports/mps-group-plans" && init?.method === "POST")).toBe(true));
    const exportRequests = vi.mocked(api).mock.calls.filter(([path, init]) => String(path) === "/table-exports/mps-group-plans" && init?.method === "POST");
    const requestBody = JSON.parse(String(exportRequests[exportRequests.length - 1]?.[1]?.body ?? "{}"));
    expect(requestBody).toMatchObject({
      rangeType: "SELECTED", selectedIds: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]
    });
    expect(requestBody.columnKeys).toContain("orderNumber");
    expect(requestBody.columnKeys).not.toContain("itemName");
    view.rerender(<AntApp><QueryClientProvider client={client}><KdosDataTable {...props} viewKey="different-view"
      dataSource={[{ id: "22222222-2222-4222-8222-222222222222", orderNumber: "B", itemName: "hidden-B" }]} /></QueryClientProvider></AntApp>);
    await screen.findByRole("button", { name: /导出当前视图/ });
    await waitFor(() => expect(view.container.querySelector(".kdos-data-table-selection-toolbar")).toBeNull());
  });
  it('display aliases bind registered permission fields without changing saved layout keys or widths',async()=>{
    savedPreferences.set(prefKey('equipment-register',undefined,'DISPLAY'),{version:1,visibleFieldKeys:['divisionName','equipmentCode'],orderedFieldKeys:['divisionName','equipmentCode'],columnWidths:{divisionName:232},pinnedFieldKeys:[]});
    localStorage.setItem('sessionUser',JSON.stringify({sub:'table-user',permissions:['equipment-register:*:read','equipment-register:divisionId:read','equipment-register:equipmentCode:read']}));
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const view=render(<QueryClientProvider client={client}><KdosDataTable resource="equipment-register" columns={[{title:'所属事业部',key:'divisionName',dataIndex:'divisionName',permissionField:'divisionId'},{title:'设备编号',dataIndex:'equipmentCode'}]} dataSource={[{id:'1',divisionId:'SYN-UUID',divisionName:'合成事业部名称',equipmentCode:'SYN-CODE'}]}/></QueryClientProvider>);
    await screen.findByText('合成事业部名称');expect(screen.queryByText('SYN-UUID')).toBeNull();expect(view.container.querySelector('th[data-kdos-column-key="divisionName"]')).toHaveAttribute('data-kdos-column-width','232');expect(savedPreferences.get(prefKey('equipment-register',undefined,'DISPLAY'))).toMatchObject({visibleFieldKeys:['divisionName','equipmentCode'],columnWidths:{divisionName:232}});expect(vi.mocked(api).mock.calls.some(([,o])=>o?.method==='PUT')).toBe(false);
  });
  it('an unknown explicit permission field fails closed even when its title matches a readable registered field',()=>{
    render(<QueryClientProvider client={new QueryClient()}><KdosDataTable resource="equipment-register" simple columns={[{title:'事业部',dataIndex:'alias',permissionField:'notRegistered'}]} dataSource={[{id:'1',alias:'不得泄露的名称'}]}/></QueryClientProvider>);expect(screen.queryByText('不得泄露的名称')).toBeNull();
  });
  it('nested display aliases cannot borrow read permission from their dataIndex instead of the bound identity',()=>{
    localStorage.setItem('sessionUser',JSON.stringify({permissions:['equipment-register:*:read','equipment-register:equipmentName:read']}));
    render(<QueryClientProvider client={new QueryClient()}><KdosDataTable resource="equipment-register" simple columns={[{title:'组织',children:[{title:'事业部',dataIndex:'equipmentName',permissionField:'divisionId'}]}]} dataSource={[{id:'1',equipmentName:'不得借用其他字段授权'}]}/></QueryClientProvider>);expect(screen.queryByText('不得借用其他字段授权')).toBeNull();
  });

});
