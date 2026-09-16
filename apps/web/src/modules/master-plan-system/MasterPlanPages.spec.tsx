import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { message } from "antd";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { api } from "../../api";
import { MasterPlanResourcePage } from "./MasterPlanPages";

vi.mock("../../api", () => ({ api: vi.fn() }));

let currentLocation = "";

function LocationSpy() {
  const location = useLocation();
  currentLocation = `${location.pathname}${location.search}`;
  return null;
}

function ResourceRoute() {
  const { resource } = useParams();
  return <MasterPlanResourcePage resource={String(resource)} />;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(resource: string, initialEntry = `/master-plan-system/${resource}`, client = newClient()) {
  currentLocation = initialEntry;
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <LocationSpy />
          <Routes>
            <Route path="/master-plan-system/:resource" element={<ResourceRoute />} />
            <Route path="*" element={<div>未匹配路由</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  };
}

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
    renderPage("mps-shipping-plans");

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
    renderPage("mps-shipping-plans");
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
    renderPage("mps-shipping-plans");
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
    renderPage("mps-shipping-plans");
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    expect(screen.queryByDisplayValue("无字段修改权")).not.toBeInTheDocument();
    expect(await screen.findByText("无字段修改权", {}, { timeout: 5_000 })).toBeInTheDocument();
  });

  it("does not PATCH an unchanged value", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return { resource: "mps-shipping-plans", fields: [{ key: "itemName", label: "品项名称", type: "text", editable: true }], createFields: [], actions: { create: false, update: true, delete: false, import: false, export: false, batchUpdate: false } } as never;
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?")) return { rows: [{ id: "row-1", version: 4, itemName: "未变化", canUpdate: true }], total: 1 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    renderPage("mps-shipping-plans");
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
    renderPage("mps-shipping-plans");
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
    renderPage("mps-shipping-plans");
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
    renderPage("mps-shipping-plans");
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    const checkboxes = await screen.findAllByRole("checkbox"); fireEvent.click(checkboxes.at(-1)!);
    fireEvent.click(await screen.findByRole("button", { name: "批量修改" }));
    expect(await screen.findByRole("dialog", { name: /批量修改/ })).toBeInTheDocument();
    expect(screen.getByText(/本次操作将修改 1 条数据/)).toBeInTheDocument();
  }, 15_000);

  it("keeps preview and confirm failures visible instead of closing the import dialog", async () => {
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return { resource: "mps-shipping-plans", fields: [], createFields: [], actions: { create: false, update: false, delete: false, import: true, export: false, batchUpdate: false } } as never;
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?")) return { rows: [], total: 0 } as never;
      if (path.endsWith("/import-preview")) return { total: 1255, errors: [], previewId: "22222222-2222-4222-8222-222222222222" } as never;
      if (path.endsWith("/import-confirm") && init?.method === "POST") throw new Error("记录版本已变化，请重新导出后导入");
      throw new Error(`unexpected request: ${path}`);
    });
    const { container } = renderPage("mps-shipping-plans");
    await screen.findByText("导入");
    const input = container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["test"], "import.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })] } });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("共解析 1255 条。确认后整批事务提交。")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /确认导入|OK/ }));
    await waitFor(() => expect(within(dialog).getByText(/本次整批数据均未写入/)).toBeInTheDocument());
    expect(dialog).toBeInTheDocument();
  }, 15_000);
});

describe("MasterPlanResourcePage base-plan weekly feedback", () => {
  const basePlanId = "33333333-3333-4333-8333-333333333333";
  const baseMeta = { resource: "mps-base-plans", fields: tablePermissionFieldsFor("mps-base-plans"), createFields: [], actions: { create: false, update: true, delete: false, import: false, export: true, batchUpdate: false, viewWeekly: true } };
  const baseRow = {
    id: "row-1", version: 4, itemName: "基础品项", latestReviewDueDate: null,
    weeklyPlanState: "待完善", weeklyPlanMissingFields: "最迟评审交期、生产方式", weeklyPlanGenerationIssue: null, weeklyPlanId: null, canUpdate: true
  };

  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["*"], isSystemAdmin: true }));
  });

  afterEach(() => cleanup());

  const mockBasePlans = (overrides: Record<string, unknown> = {}) => {
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return baseMeta as never;
      if (path.startsWith("/master-plan-system/resources/mps-base-plans?") && !init) return { rows: [{ ...baseRow, ...overrides }], total: 1 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
  };

  it("renders the read-only weekly state, missing admission fields and the generation hint", async () => {
    mockBasePlans({ weeklyPlanGenerationIssue: "未维护工序周期" });
    renderPage("mps-base-plans");

    expect(await screen.findByText("待完善", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText("缺少：最迟评审交期、生产方式")).toBeInTheDocument();
    expect(screen.getByText("生成失败：未维护工序周期")).toBeInTheDocument();
  });

  it("locates the generated weekly plan by stable base_plan_id instead of a business search", async () => {
    mockBasePlans({ weeklyPlanState: "已进入周计划", weeklyPlanMissingFields: null, weeklyPlanId: basePlanId });
    renderPage("mps-base-plans");

    expect(await screen.findByText("已进入周计划", {}, { timeout: 10_000 })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "查看周计划" }));

    /* 定位参数必须是基础计划自身的稳定 ID（上游关系），不是周计划 ID 或订单业务键。 */
    await waitFor(() => expect(currentLocation).toBe("/master-plan-system/mps-weekly-plans?basePlanId=row-1"));
  }, 20_000);

  it("shows the located base-plan notice on the weekly plan page and can clear the locator", async () => {
    const weeklyMeta = { resource: "mps-weekly-plans", fields: tablePermissionFieldsFor("mps-weekly-plans"), createFields: [], actions: { create: false, update: false, delete: false, import: false, export: false, batchUpdate: false } };
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return weeklyMeta as never;
      if (path.startsWith("/master-plan-system/resources/mps-weekly-plans?") && !init) return { rows: [{ id: "weekly-1", version: 1, orderNumber: "2026A027192" }], total: 1 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    renderPage("mps-weekly-plans", `/master-plan-system/mps-weekly-plans?page=1&pageSize=50&view=ALL&basePlanId=${basePlanId}`);

    expect(await screen.findByText("仅显示该事业部基础计划生成的周计划")).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path]) => String(path).includes(`basePlanId=${basePlanId}`))).toBe(true));
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "清除定位" }));
    await waitFor(() => expect(currentLocation).toBe("/master-plan-system/mps-weekly-plans"));
  }, 20_000);

  it("invalidates both base plans and weekly plans after an inline save and surfaces the reconciliation failure", async () => {
    const client = newClient();
    let patched = false;
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return baseMeta as never;
      if (path === "/master-plan-system/resources/mps-base-plans/row-1" && init?.method === "PATCH") {
        patched = true;
        return { version: 5, values: { itemName: "新基础品项" }, reconciliation: { status: "FAILED", message: "基础计划已保存，但周计划生成失败：未维护工序周期" } } as never;
      }
      if (path.startsWith("/master-plan-system/resources/mps-base-plans?") && !init) return { rows: [{ ...baseRow, itemName: patched ? "新基础品项" : "基础品项" }], total: 1 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    renderPage("mps-base-plans", "/master-plan-system/mps-base-plans", client);
    const invalidated = vi.spyOn(client, "invalidateQueries");
    const warning = vi.spyOn(message, "warning").mockImplementation(() => undefined as never);

    expect(await screen.findByText("待完善", {}, { timeout: 10_000 })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    const input = await screen.findByDisplayValue("基础品项", {}, { timeout: 5_000 }); fireEvent.change(input, { target: { value: "新基础品项" } }); fireEvent.blur(input);

    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("/master-plan-system/resources/mps-base-plans/row-1", expect.objectContaining({ method: "PATCH" })));
    await waitFor(() => expect(warning).toHaveBeenCalledWith("基础计划已保存，但周计划生成失败：未维护工序周期"));
    const invalidatedKeys = invalidated.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey ?? []));
    expect(invalidatedKeys.some((key) => key.includes("mps-base-plans"))).toBe(true);
    expect(invalidatedKeys.some((key) => key.includes("mps-weekly-plans"))).toBe(true);
  }, 20_000);
});
