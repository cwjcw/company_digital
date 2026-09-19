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

  it("shows the manual base-to-weekly action only with sync update permission", async () => {
    mockBasePlans();
    renderPage("mps-base-plans");
    await screen.findByText("待完善");
    expect(screen.getByRole("button", { name: /同步到周计划/ })).toBeInTheDocument();
  });

  it("hides the manual base-to-weekly action without sync update permission", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["mps-base-plans:*:read", "mps-base-plans:*:update"] }));
    mockBasePlans();
    renderPage("mps-base-plans");
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("/master-plan-system/resources/mps-base-plans/meta"));
    expect(screen.queryByRole("button", { name: "同步到周计划" })).not.toBeInTheDocument();
  });

  it("requires confirmation before calling base-to-weekly", async () => {
    mockBasePlans();
    renderPage("mps-base-plans");
    await screen.findByText("待完善");
    fireEvent.click(screen.getByText("同步到周计划"));

    const dialog = await screen.findByText("确认同步到周计划？").then((title) => title.closest<HTMLElement>(".ant-modal"));
    expect(dialog).not.toBeNull();
    if (!dialog) throw new Error("confirmation modal did not open");
    expect(within(dialog).getByText("确认同步到周计划？")).toBeInTheDocument();
    expect(within(dialog).getByText(/该操作不是只同步当前筛选结果/)).toBeInTheDocument();
    expect(vi.mocked(api).mock.calls.some(([path, init]) => String(path).includes("/sync/base-to-weekly") && init?.method === "POST")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: /取\s*消/ }));
  });

  it.each([
    [{ count: 3 }, "同步到周计划完成，共处理 3 条变更"],
    [{ count: 0 }, "同步完成，没有需要更新的数据"]
  ] as const)("calls base-to-weekly once and reports count=%s", async (result, successText) => {
    const success = vi.spyOn(message, "success").mockImplementation(() => undefined as never);
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return baseMeta as never;
      if (path.startsWith("/master-plan-system/resources/mps-base-plans?") && !init) return { rows: [{ ...baseRow }], total: 1 } as never;
      if (path === "/master-plan-system/sync/base-to-weekly" && init?.method === "POST") return result as never;
      throw new Error(`unexpected request: ${path}`);
    });
    renderPage("mps-base-plans");
    await screen.findByText("待完善");
    fireEvent.click(screen.getByText("同步到周计划"));
    const dialog = await screen.findByText("确认同步到周计划？").then((title) => title.closest<HTMLElement>(".ant-modal"));
    expect(dialog).not.toBeNull();
    if (!dialog) throw new Error("confirmation modal did not open");
    fireEvent.click(within(dialog).getByRole("button", { name: /确认同步/ }));

    await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([path, init]) => path === "/master-plan-system/sync/base-to-weekly" && init?.method === "POST")).toHaveLength(1));
    expect(success).toHaveBeenCalledWith(successText);
    success.mockRestore();
  });

  it("shows the backend error and restores the action after a failed sync", async () => {
    const error = vi.spyOn(message, "error").mockImplementation(() => undefined as never);
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return baseMeta as never;
      if (path.startsWith("/master-plan-system/resources/mps-base-plans?") && !init) return { rows: [{ ...baseRow }], total: 1 } as never;
      if (path === "/master-plan-system/sync/base-to-weekly" && init?.method === "POST") throw new Error("后端真实错误");
      throw new Error(`unexpected request: ${path}`);
    });
    renderPage("mps-base-plans");
    await screen.findByText("待完善");
    fireEvent.click(screen.getByText("同步到周计划"));
    const dialog = await screen.findByText("确认同步到周计划？").then((title) => title.closest<HTMLElement>(".ant-modal"));
    if (!dialog) throw new Error("confirmation modal did not open");
    fireEvent.click(within(dialog).getByRole("button", { name: /确认同步/ }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("同步到周计划失败：后端真实错误"));
    expect(screen.getByRole("button", { name: /同步到周计划/ })).not.toBeDisabled();
    error.mockRestore();
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

describe("MasterPlanResourcePage weekly execution refresh", () => {
  const weeklyId = "33333333-3333-4333-8333-333333333333";
  const weeklyMeta = { resource: "mps-weekly-plans", fields: tablePermissionFieldsFor("mps-weekly-plans"), createFields: [], actions: { create: false, update: true, delete: false, import: false, export: false, batchUpdate: false } };

  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["*"], isSystemAdmin: true }));
  });

  afterEach(() => cleanup());

  it("refreshes one weekly plan from the more menu only after confirmation", async () => {
    const client = newClient(); const invalidated = vi.spyOn(client, "invalidateQueries");
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return weeklyMeta as never;
      if (path.startsWith("/master-plan-system/resources/mps-weekly-plans?") && !init) return { rows: [{ id: weeklyId, version: 3, orderNumber: "2026A027336", itemCode: "TGH002HT-1/1", canUpdate: true }], total: 1 } as never;
      if (path === `/master-plan-system/resources/mps-weekly-plans/${weeklyId}/refresh-execution` && init?.method === "POST") return { id: weeklyId, version: 4 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    renderPage("mps-weekly-plans", "/master-plan-system/mps-weekly-plans", client);
    await screen.findByText("2026A027336");
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "刷新工序任务" }));
    const dialog = await screen.findByRole("dialog", { name: "确认刷新工序任务？" });
    expect(within(dialog).getByText(/不会删除已有实际报工记录/)).toBeInTheDocument();
    expect(vi.mocked(api).mock.calls.some(([path, init]) => String(path).includes("refresh-execution") && init?.method === "POST")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "确认刷新" }));
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith(`/master-plan-system/resources/mps-weekly-plans/${weeklyId}/refresh-execution`, { method: "POST" }));
    const keys = invalidated.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey ?? []));
    for (const resource of ["mps-weekly-plans", "mps-weekly-process-plans", "mps-process-reports", "mps-outsourcing-reports", "mps-technical-reports", "mps-material-reports"]) expect(keys.some((key) => key.includes(resource))).toBe(true);
  }, 20_000);
});

describe("MasterPlanResourcePage pending process reporting", () => {
  const weeklyPlanId = "33333333-3333-4333-8333-333333333333";
  const pendingRow = {
    id: "44444444-4444-4444-8444-444444444444", version: 2, weeklyPlanId, processCode: "bending",
    orderNumber: "2026A027192", itemCode: "TGG919BDP-1/1", itemName: "品项", plannedQuantity: "100.0000",
    cumulativeReportedQuantity: "40.0000", remainingQuantity: "60.0000", canUpdate: false, canDelete: false, pendingTask: true
  };
  const pendingFields = [
    { key: "orderNumber", label: "订单编号", type: "text", editable: false, required: false, input: false },
    { key: "itemCode", label: "品项编码", type: "text", editable: false, required: false, input: false },
    { key: "itemName", label: "品项名称", type: "text", editable: false, required: false, input: false },
    { key: "processCode", label: "工序", type: "dictionary", editable: false, required: false, input: false, options: [{ value: "bending", label: "折弯" }] },
    { key: "plannedQuantity", label: "计划数量", type: "number", editable: false, required: false, input: false },
    { key: "cumulativeReportedQuantity", label: "累计报工", type: "number", editable: false, required: false, input: false },
    { key: "remainingQuantity", label: "剩余数量", type: "number", editable: false, required: false, input: false },
    { key: "productionQuantity", label: "本次报工数量", type: "number", editable: true, required: true, input: true },
    { key: "productionDate", label: "生产日期", type: "date", editable: true, required: true, input: true },
    /* KN-MPS-UI-001：异常为可选人工文本，和本次报工数量/生产日期一起提交。 */
    { key: "exceptionText", label: "异常", type: "text", editable: true, required: false, input: true }
  ];
  const meta = { resource: "mps-process-reports", fields: [{ key: "productionQuantity", label: "报工数量", type: "number", editable: true }], createFields: [], pendingFields, actions: { create: true, update: true, delete: true, import: true, export: false, batchUpdate: false, reportProcess: true } };

  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["*"], isSystemAdmin: true }));
  });

  afterEach(() => cleanup());

  const mockPending = (onReport?: (body: any) => void) => {
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return meta as never;
      if (path === "/master-plan-system/resources/mps-process-reports" && init?.method === "POST") { onReport?.(JSON.parse(String(init.body))); return { id: "report-1", reconciliation: { status: "SUCCESS", message: null } } as never; }
      if (path.includes("view=PENDING")) return { rows: [pendingRow], total: 1 } as never;
      if (path.startsWith("/master-plan-system/resources/mps-process-reports?")) return { rows: [], total: 0 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
  };

  it("renders the approved pending columns in order with no action column and read-only tasks", async () => {
    mockPending();
    const { container } = renderPage("mps-process-reports", "/master-plan-system/mps-process-reports");
    fireEvent.click(await screen.findByRole("tab", { name: "待报工任务" }));

    await waitFor(() => expect(screen.getByText("2026A027192")).toBeInTheDocument());
    const headers = Array.from(container.querySelectorAll(".ant-table-thead th")).map((cell) => cell.textContent?.trim() ?? "");
    for (const label of ["订单编号", "品项编码", "品项名称", "工序", "计划数量", "累计报工", "剩余数量", "本次报工数量", "生产日期", "异常"]) expect(headers).toContain(label);
    /* 异常列在最后（与权威定义顺序一致，不新增操作列）。 */
    expect(headers.indexOf("异常")).toBeGreaterThan(headers.indexOf("生产日期"));
    expect(headers.indexOf("品项编码")).toBeGreaterThan(headers.indexOf("订单编号"));
    expect(headers.indexOf("品项名称")).toBeGreaterThan(headers.indexOf("品项编码"));
    expect(headers).not.toContain("操作");
    expect(headers).not.toContain("更多操作");
    expect(screen.getByText("40.0000")).toBeInTheDocument();
    expect(screen.getByText("60.0000")).toBeInTheDocument();
    /* 只读浏览模式下没有可填写的报工控件。 */
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  }, 20_000);

  it("creates an actual report from the pending row and refreshes the weekly plan", async () => {
    const bodies: any[] = []; mockPending((body) => bodies.push(body));
    const client = newClient(); const invalidated = vi.spyOn(client, "invalidateQueries");
    renderPage("mps-process-reports", "/master-plan-system/mps-process-reports", client);
    fireEvent.click(await screen.findByRole("tab", { name: "待报工任务" }));
    await screen.findByText("2026A027192", {}, { timeout: 10_000 });

    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    const quantity = await screen.findByPlaceholderText("本次报工", {}, { timeout: 5_000 }) as HTMLInputElement;
    fireEvent.change(quantity, { target: { value: "20" } });
    fireEvent.click(await screen.findByRole("button", { name: /提交报工/ }));

    await waitFor(() => expect(bodies.length).toBe(1));
    /* 提交语义是 CREATE 实际报工：身份来自待报工任务，不允许前端自带来源快照。 */
    expect(bodies[0]).toMatchObject({ weeklyPlanId, processCode: "bending", productionQuantity: 20 });
    expect(typeof bodies[0].productionDate).toBe("string");
    expect(Object.keys(bodies[0]).sort()).toEqual(["processCode", "productionDate", "productionQuantity", "weeklyPlanId"]);
    await waitFor(() => expect(invalidated.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey ?? [])).some((key) => key.includes("mps-weekly-plans"))).toBe(true));
  }, 25_000);

  it("submits the optional human exception with the report and omits it when left blank", async () => {
    const bodies: any[] = []; mockPending((body) => bodies.push(body));
    renderPage("mps-process-reports", "/master-plan-system/mps-process-reports");
    fireEvent.click(await screen.findByRole("tab", { name: "待报工任务" }));
    await screen.findByText("2026A027192", {}, { timeout: 10_000 });

    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    const quantity = await screen.findByPlaceholderText("本次报工", {}, { timeout: 5_000 }) as HTMLInputElement;
    fireEvent.change(quantity, { target: { value: "20" } });
    const exception = await screen.findByPlaceholderText("可选：人工确认的异常") as HTMLInputElement;
    fireEvent.change(exception, { target: { value: "  夹具异常  " } });
    fireEvent.click(await screen.findByRole("button", { name: /提交报工/ }));

    await waitFor(() => expect(bodies.length).toBe(1));
    /* 人工异常原样（去首尾空格）写入本次报工事实。 */
    expect(bodies[0]).toMatchObject({ weeklyPlanId, processCode: "bending", productionQuantity: 20, exceptionText: "夹具异常" });

    /* 留空时不写入 exceptionText（不制造空异常）。 */
    fireEvent.change(await screen.findByPlaceholderText("可选：人工确认的异常") as HTMLInputElement, { target: { value: "" } });
    fireEvent.change(await screen.findByPlaceholderText("本次报工", {}, { timeout: 5_000 }) as HTMLInputElement, { target: { value: "10" } });
    fireEvent.click(await screen.findByRole("button", { name: /提交报工/ }));
    await waitFor(() => expect(bodies.length).toBe(2));
    expect(Object.keys(bodies[1]).sort()).toEqual(["processCode", "productionDate", "productionQuantity", "weeklyPlanId"]);
  }, 25_000);

  /* KN-MPS-UI-REPORT-001：报工成功必须立即可见，刷新失败不得否定已保存的报工。 */
  const rowOf = (id: string, orderNumber: string, processCode: string) => ({ ...pendingRow, id, orderNumber, itemCode: `${orderNumber}-ITEM`, processCode });
  const secondRow = rowOf("55555555-5555-4555-8555-555555555555", "2026A027193", "cutting");
  const mockSubmit = (report: (body: any) => unknown) => {
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return meta as never;
      if (path === "/master-plan-system/resources/mps-process-reports" && init?.method === "POST") return await report(JSON.parse(String(init.body))) as never;
      if (path.includes("view=PENDING")) return { rows: [pendingRow, secondRow], total: 2 } as never;
      if (path.startsWith("/master-plan-system/resources/mps-process-reports?")) return { rows: [], total: 0 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
  };
  const openPending = async () => {
    renderPage("mps-process-reports", "/master-plan-system/mps-process-reports");
    fireEvent.click(await screen.findByRole("tab", { name: "待报工任务" }));
    await screen.findByText("2026A027192", {}, { timeout: 10_000 });
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
  };
  const quantityInputs = () => screen.findAllByPlaceholderText("本次报工", {}, { timeout: 5_000 });
  /* antd InputNumber 按 precision=4 回显，断言只比较数值，避免格式差异造成假失败。 */
  const quantityValues = () => Array.from(document.querySelectorAll("input[placeholder='本次报工']")).map((input) => Number((input as HTMLInputElement).value || 0));
  const fill = async (values: string[]) => {
    const inputs = await quantityInputs();
    for (let index = 0; index < values.length; index += 1) fireEvent.change(inputs[index]!, { target: { value: values[index] } });
  };
  const submitButton = () => screen.getByRole("button", { name: /提交报工/ });

  it("Case 1：单条成功后立即反馈，清空该条输入并恢复 loading", async () => {
    mockSubmit(() => ({ id: "report-1", reconciliation: { status: "SUCCESS", message: null } }));
    const success = vi.spyOn(message, "success").mockImplementation(() => undefined as never);
    await openPending(); await fill(["20"]);
    fireEvent.click(submitButton());

    await waitFor(() => expect(success).toHaveBeenCalledWith("报工成功；事业部计划已刷新"));
    await waitFor(() => expect(quantityValues()).toEqual([0, 0]));
    const button = submitButton();
    expect(button).toBeDisabled();
    expect(button.className).not.toContain("ant-btn-loading");
  }, 25_000);

  it("Case 2：成功后刷新失败仍显示报工成功，并额外提示刷新失败", async () => {
    const client = newClient();
    mockSubmit(() => ({ id: "report-1", reconciliation: { status: "SUCCESS", message: null } }));
    const success = vi.spyOn(message, "success").mockImplementation(() => undefined as never);
    const warning = vi.spyOn(message, "warning").mockImplementation(() => undefined as never);
    /* 缓存刷新异常：不得把已经成功的报工表现成失败。 */
    vi.spyOn(client, "invalidateQueries").mockRejectedValue(new Error("cache boom"));
    renderPage("mps-process-reports", "/master-plan-system/mps-process-reports", client);
    fireEvent.click(await screen.findByRole("tab", { name: "待报工任务" }));
    await screen.findByText("2026A027192", {}, { timeout: 10_000 });
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    await fill(["20"]);
    fireEvent.click(submitButton());

    await waitFor(() => expect(success).toHaveBeenCalledWith("报工成功；事业部计划已刷新"));
    await waitFor(() => expect(warning).toHaveBeenCalledWith("报工已保存，但页面数据刷新失败，请手动刷新页面"));
  }, 25_000);

  it("Case 3：POST 失败时保留输入、给出后端错误、不出现成功提示", async () => {
    mockSubmit(() => { throw new Error("当前生产方式不允许创建工序任务或工序报工"); });
    const error = vi.spyOn(message, "error").mockImplementation(() => undefined as never);
    const success = vi.spyOn(message, "success").mockImplementation(() => undefined as never);
    await openPending(); await fill(["20"]);
    fireEvent.click(submitButton());

    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("报工提交失败：")));
    expect(String(error.mock.calls[0]![0])).toContain("当前生产方式不允许创建工序任务或工序报工");
    expect(success).not.toHaveBeenCalled();
    expect(quantityValues()).toEqual([20, 0]);
    const button = submitButton();
    expect(button).toBeEnabled();
    expect(button.className).not.toContain("ant-btn-loading");
  }, 25_000);

  it("Case 4：部分成功时只清空成功记录，失败记录保留原数量", async () => {
    mockSubmit((body) => body.processCode === "cutting"
      ? (() => { throw new Error("cutting 报工被拒绝"); })()
      : ({ id: "report-1", reconciliation: { status: "SUCCESS", message: null } }));
    const warning = vi.spyOn(message, "warning").mockImplementation(() => undefined as never);
    await openPending(); await fill(["20", "20"]);
    fireEvent.click(submitButton());

    await waitFor(() => expect(warning).toHaveBeenCalledWith(expect.stringContaining("已成功提交 1 条报工，1 条提交失败")));
    expect(String(warning.mock.calls[0]![0])).toContain("cutting 报工被拒绝");
    await waitFor(() => expect(quantityValues()).toEqual([0, 20]));
  }, 25_000);

  it("Case 5：多条全部成功时清空全部输入并让按钮回到 disabled", async () => {
    mockSubmit(() => ({ id: "report-1", reconciliation: { status: "SUCCESS", message: null } }));
    const success = vi.spyOn(message, "success").mockImplementation(() => undefined as never);
    await openPending(); await fill(["20", "30"]);
    fireEvent.click(submitButton());

    await waitFor(() => expect(success).toHaveBeenCalledWith("已成功提交 2 条报工；事业部计划已刷新"));
    await waitFor(() => expect(quantityValues()).toEqual([0, 0]));
    expect(submitButton()).toBeDisabled();
  }, 25_000);

  it("Case 6：意外异常后 loading 必须恢复（finally），且不残留已成功输入", async () => {
    let attempts = 0;
    mockSubmit(() => { attempts += 1; return { id: `report-${attempts}`, reconciliation: { status: "SUCCESS", message: null } }; });
    /* 反馈层抛出意外异常：必须在 finally 恢复 loading，并在兜底分支清理已成功输入。 */
    vi.spyOn(message, "success").mockImplementationOnce(() => { throw new Error("toast boom"); }).mockImplementation(() => undefined as never);
    const warning = vi.spyOn(message, "warning").mockImplementation(() => undefined as never);
    await openPending(); await fill(["20"]);
    fireEvent.click(submitButton());

    await waitFor(() => expect(warning).toHaveBeenCalledWith(expect.stringContaining("已成功提交 1 条报工")));
    await waitFor(() => expect(quantityValues()).toEqual([0, 0]));
    const button = submitButton();
    expect(button.className).not.toContain("ant-btn-loading");
    /* loading 已恢复：重新填写后可再次提交（若 pendingSubmitting 卡死则不会产生第二次 POST）。 */
    await fill(["5"]);
    fireEvent.click(submitButton());
    await waitFor(() => expect(attempts).toBe(2));
  }, 25_000);
});

describe("MasterPlanResourcePage weekly plan process groups", () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["*"], isSystemAdmin: true }));
  });
  afterEach(() => cleanup());

  it("renders the 毛坯 field group between 研磨 and 表面处理 from the canonical process registry", async () => {
    const processField = (code: string, label: string, suffix: string, suffixLabel: string, type: string) =>
      ({ key: `${code}${suffix}`, label: `${label}·${suffixLabel}`, type, editable: false, required: false });
    const fields = [
      { key: "orderNumber", label: "订单编号", type: "text", editable: true, required: true },
      processField("grinding", "研磨", "CycleDays", "所需周期", "number"),
      processField("grinding", "研磨", "Status", "状态", "dictionary"),
      processField("blank", "毛坯", "CycleDays", "所需周期", "number"),
      processField("blank", "毛坯", "DueDate", "交期", "date"),
      processField("blank", "毛坯", "Status", "状态", "dictionary"),
      processField("blank", "毛坯", "ProductionProgress", "生产进度", "number"),
      { key: "exceptionSummary", label: "异常", type: "text", editable: false, required: false },
      processField("surfaceTreatment", "表面处理", "Status", "状态", "dictionary"),
      { key: "packagingStatus", label: "包装·状态", type: "dictionary", editable: false, required: false }
    ];
    const processes = [
      { code: "cutting", name: "下料", order: 1 }, { code: "machining", name: "机加", order: 2 }, { code: "bending", name: "折弯", order: 3 },
      { code: "spotWelding", name: "点焊", order: 4 }, { code: "welding", name: "焊接", order: 5 }, { code: "woodworking", name: "木作", order: 6 },
      { code: "grinding", name: "研磨", order: 7 }, { code: "blank", name: "毛坯", order: 8 },
      { code: "surfaceTreatment", name: "表面处理", order: 9 }, { code: "packaging", name: "包装", order: 10 }
    ];
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) return { resource: "mps-weekly-plans", fields, createFields: [], processes, actions: { create: false, update: false, delete: false, import: false, export: false, batchUpdate: false } } as never;
      if (path.startsWith("/master-plan-system/resources/mps-weekly-plans?")) return { rows: [{ id: "w1", version: 1, orderNumber: "2026A027192" }], total: 1 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const { container } = renderPage("mps-weekly-plans");
    await screen.findByDisplayValue("") .catch(() => undefined);
    await waitFor(() => expect(container.querySelectorAll(".ant-table-thead").length).toBeGreaterThan(0));

    const headerRows = Array.from(container.querySelectorAll(".ant-table-thead tr"));
    const headers = Array.from(container.querySelectorAll(".ant-table-thead th")).map((cell) => cell.textContent?.trim() ?? "");
    const groupTitles = headers.filter((header) => ["研磨", "毛坯", "表面处理", "包装"].includes(header));
    expect(groupTitles).toEqual(["研磨", "毛坯", "表面处理", "包装"]);
    /* 第一行是工序分组标题（顺序即 registry），第二行是组内字段标题：毛坯组包含周期/交期/状态/异常。 */
    expect(headers.indexOf("研磨")).toBeLessThan(headers.indexOf("毛坯"));
    expect(headers.indexOf("毛坯")).toBeLessThan(headers.indexOf("表面处理"));
    const childHeaders = Array.from((headerRows.at(-1) ?? headerRows[0]!).querySelectorAll("th")).map((cell) => cell.textContent?.trim() ?? "");
    /* KN-MPS-EXEC-001：工序组内字段固定为 周期/交期/状态/生产进度（不再有每工序异常列）。 */
    /* 组内字段为 周期/交期/状态/生产进度（该用例只 mock 了部分工序字段，其余工序显示占位，不泄露数据）。 */
    expect(childHeaders).toContain("所需周期");
    expect(childHeaders).toContain("状态");
    expect(childHeaders).toContain("生产进度");
    expect(childHeaders).not.toContain("异常");
    expect(childHeaders.indexOf("毛坯")).toBe(-1);
    /* 整张表只有 1 个「异常」列（统一异常汇总），位于工序组之后。 */
    const exceptionHeaders = headers.filter((header) => header === "异常");
    expect(exceptionHeaders.length).toBe(1);
    expect(headers.indexOf("异常")).toBeGreaterThan(headers.indexOf("包装"));
  }, 20_000);
});
