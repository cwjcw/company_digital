import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { MasterPlanResourcePage } from "./MasterPlanPages";

vi.mock("../../api", () => ({ api: vi.fn() }));

describe("MasterPlanResourcePage create feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["*"], isSystemAdmin: true }));
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) {
        const fields = tablePermissionFieldsFor("mps-shipping-plans");
        return { resource: "mps-shipping-plans", fields, createFields: fields.filter((field) => field.editable), actions: { create: true, update: true, delete: true, import: true, export: true, batchUpdate: true } } as never;
      }
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?")) return { rows: [], total: 0 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
  });

  afterEach(() => cleanup());

  it("shows a concrete validation error instead of silently ignoring confirm", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MasterPlanResourcePage resource="mps-shipping-plans" /></QueryClientProvider>);

    fireEvent.click(await screen.findByRole("button", { name: /新\s*增/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /OK|确\s*定/ }));

    await waitFor(() => expect(screen.getAllByText("请填写客户编码").length).toBeGreaterThan(0));
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(dialog).toBeInTheDocument();
  }, 15_000);

  it("patches only the changed cell with expectedVersion after edit mode is entered", async () => {
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) {
        const fields = tablePermissionFieldsFor("mps-shipping-plans");
        return { resource: "mps-shipping-plans", fields, createFields: fields.filter((field) => field.editable), actions: { create: true, update: true, delete: true, import: true, export: true, batchUpdate: true } } as never;
      }
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?") && !init) return { rows: [{ id: "row-1", version: 4, itemName: "旧品项名称", canUpdate: true }], total: 1 } as never;
      if (path === "/master-plan-system/resources/mps-shipping-plans/row-1" && init?.method === "PATCH") return { version: 5, values: { itemName: "新品项名称" } } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MasterPlanResourcePage resource="mps-shipping-plans" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    const input = await screen.findByDisplayValue("旧品项名称"); fireEvent.change(input, { target: { value: "新品项名称" } }); fireEvent.blur(input);
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("/master-plan-system/resources/mps-shipping-plans/row-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ itemName: "新品项名称", expectedVersion: 4 }) })));
    expect(await screen.findByDisplayValue("新品项名称")).toBeInTheDocument();
  }, 15_000);

  it("is read-only by default and becomes read-only again after exiting edit mode", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return { resource: "mps-shipping-plans", fields: [{ key: "itemName", label: "品项名称", type: "text", editable: true }], createFields: [], actions: { create: false, update: true, delete: false, import: false, export: false, batchUpdate: true } } as never;
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?")) return { rows: [{ id: "row-1", version: 4, itemName: "只读品项", canUpdate: true }], total: 1 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MasterPlanResourcePage resource="mps-shipping-plans" /></QueryClientProvider>);
    expect(await screen.findByText("只读品项")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("只读品项")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /进入\s*编辑模式/ }));
    expect(await screen.findByDisplayValue("只读品项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /退出\s*编辑模式/ }));
    await waitFor(() => expect(screen.queryByDisplayValue("只读品项")).not.toBeInTheDocument());
  });

  it("does not edit a field without field update permission", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["mps-shipping-plans:*:read", "mps-shipping-plans:*:update", "mps-shipping-plans:itemName:read"] }));
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return { resource: "mps-shipping-plans", fields: [{ key: "itemName", label: "品项名称", type: "text", editable: true }], createFields: [], actions: { create: false, update: true, delete: false, import: false, export: false, batchUpdate: false } } as never;
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?")) return { rows: [{ id: "row-1", version: 4, itemName: "无字段修改权", canUpdate: true }], total: 1 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MasterPlanResourcePage resource="mps-shipping-plans" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    expect(screen.queryByDisplayValue("无字段修改权")).not.toBeInTheDocument();
    expect(screen.getByText("无字段修改权")).toBeInTheDocument();
  });

  it("does not PATCH an unchanged value", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return { resource: "mps-shipping-plans", fields: [{ key: "itemName", label: "品项名称", type: "text", editable: true }], createFields: [], actions: { create: false, update: true, delete: false, import: false, export: false, batchUpdate: false } } as never;
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?")) return { rows: [{ id: "row-1", version: 4, itemName: "未变化", canUpdate: true }], total: 1 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MasterPlanResourcePage resource="mps-shipping-plans" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    fireEvent.blur(await screen.findByDisplayValue("未变化"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("uses server-confirmed values and the latest version for consecutive blur saves", async () => {
    let save = 0;
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return { resource: "mps-shipping-plans", fields: [{ key: "itemName", label: "品项名称", type: "text", editable: true }], createFields: [], actions: { create: false, update: true, delete: false, import: false, export: false, batchUpdate: false } } as never;
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?") && !init) return { rows: [{ id: "row-1", version: 4, itemName: "原值", canUpdate: true }], total: 1 } as never;
      if (path.endsWith("/row-1") && init?.method === "PATCH") return ++save === 1 ? { version: 5, values: { itemName: "服务端规范值" } } as never : { version: 6, values: { itemName: "第二次服务端值" } } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MasterPlanResourcePage resource="mps-shipping-plans" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    let input = await screen.findByDisplayValue("原值"); fireEvent.change(input, { target: { value: "客户端值" } }); fireEvent.blur(input);
    input = await screen.findByDisplayValue("服务端规范值"); fireEvent.change(input, { target: { value: "第二次客户端值" } }); fireEvent.blur(input);
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("/master-plan-system/resources/mps-shipping-plans/row-1", expect.objectContaining({ body: JSON.stringify({ itemName: "第二次客户端值", expectedVersion: 5 }) })));
    expect(await screen.findByDisplayValue("第二次服务端值")).toBeInTheDocument();
  }, 15_000);

  it("restores the old value when a version conflict rejects the save", async () => {
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return { resource: "mps-shipping-plans", fields: [{ key: "itemName", label: "品项名称", type: "text", editable: true }], createFields: [], actions: { create: false, update: true, delete: false, import: false, export: false, batchUpdate: false } } as never;
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?") && !init) return { rows: [{ id: "row-1", version: 4, itemName: "冲突前原值", canUpdate: true }], total: 1 } as never;
      if (path.endsWith("/row-1") && init?.method === "PATCH") throw new Error("记录已被其他用户修改，请刷新后重试");
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MasterPlanResourcePage resource="mps-shipping-plans" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    const input = await screen.findByDisplayValue("冲突前原值"); fireEvent.change(input, { target: { value: "不应保留" } }); fireEvent.blur(input);
    expect(await screen.findByDisplayValue("冲突前原值")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("不应保留")).not.toBeInTheDocument();
  }, 15_000);

  it("keeps batch modification available alongside inline editing", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return { resource: "mps-shipping-plans", fields: [{ key: "itemName", label: "品项名称", type: "text", editable: true }], createFields: [], actions: { create: false, update: true, delete: false, import: false, export: false, batchUpdate: true } } as never;
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?")) return { rows: [{ id: "row-1", version: 4, itemName: "批量品项", canUpdate: true }], total: 1 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MasterPlanResourcePage resource="mps-shipping-plans" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    const checkboxes = await screen.findAllByRole("checkbox"); fireEvent.click(checkboxes.at(-1)!);
    fireEvent.click(await screen.findByRole("button", { name: "批量修改" }));
    expect(await screen.findByRole("dialog", { name: /批量修改/ })).toBeInTheDocument();
    expect(screen.getByText(/本次操作将修改 1 条数据/)).toBeInTheDocument();
  }, 15_000);
});
