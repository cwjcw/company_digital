import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { SupervisionEmployeeDashboardPage, SupervisionOwnerReportPage, SupervisionProjectDashboardPage, SupervisionProjectsPage, SupervisionTasksPage } from "./SupervisionPages";

vi.mock("../../api", () => ({ api: vi.fn() }));

const project = {
  id: "project-1", version: 1, projectCode: "SP-001", projectName: "项目甲", sourceType: "OTHER", ownerId: "user-1", supervisorId: null,
  participantIds: ["user-2"], departmentId: "dept-1", priority: "MEDIUM", plannedStartDate: "2026-09-21", dueDate: "2026-09-30",
  actualDeliveryDate: null, lifecycleStatus: "IN_PROGRESS", displayStatus: "NORMAL", progress: 20
};
const task = {
  id: "task-1", version: 1, taskCode: "ST-001", projectId: "project-1", projectName: "项目甲", taskName: "任务甲", ownerId: "user-1",
  collaboratorIds: ["user-2"], departmentId: "dept-1", priority: "MEDIUM", plannedStartDate: "2026-09-21", dueDate: "2026-09-30",
  actualDeliveryDate: null, lifecycleStatus: "IN_PROGRESS", displayStatus: "NORMAL", progress: 20
};

const permissions = (resource: string, update = true) => [
  `${resource}:*:read`, ...(update ? [`${resource}:*:update`] : []),
  ...(update ? ["projectName", "sourceType", "ownerId", "supervisorId", "participantIds", "departmentId", "priority", "plannedStartDate", "dueDate", "actualDeliveryDate", "taskName", "collaboratorIds"]
    .map((field) => `${resource}:${field}:update`) : [])
];

const queryClients = new Set<QueryClient>();

function renderPage(page: React.ReactNode, session: Record<string, unknown>, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  localStorage.setItem("sessionUser", JSON.stringify(session));
  queryClients.add(client);
  return { ...render(<QueryClientProvider client={client}><AntApp>{page}</AntApp></QueryClientProvider>), client };
}

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  let savedProject = { ...project };
  vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/supervision/options") return { users: [{ id: "user-1", label: "员工一" }, { id: "user-2", label: "员工二" }], departments: [{ id: "dept-1", name: "部门一" }], projects: [] } as never;
    if (path.startsWith("/supervision/dashboard/projects")) return {
      kpi: { total: 1, normal: 1, overdue: 0, dueWithin7Days: 1, averageProgress: 0 },
      gantt: [{ id: "project-1", projectName: "项目甲", plannedStartDate: "2026-09-21T00:00:00.000Z", dueDate: "2026-09-30T00:00:00.000Z", progress: 0 }],
      risks: [{ id: "risk-1", projectName: "项目甲", riskType: "即将到期", dueDate: "2026-09-30T00:00:00.000Z", progress: 0 }]
    } as never;
    if (path === "/table-filters/resources") return [{ code: "supervision-projects", filterableFields: [] }, { code: "supervision-tasks", filterableFields: [] }] as never;
    if (path.startsWith("/table-print/resources")) return [] as never;
    if (path.startsWith("/table-filters/rows?resource=supervision-projects")) return { rows: [savedProject], total: 1, page: 1, pageSize: 50 } as never;
    if (path.startsWith("/table-filters/rows?resource=supervision-tasks")) return { rows: [task], total: 1, page: 1, pageSize: 50 } as never;
    if (init?.method === "PATCH") {
      if (path.includes("/projects/")) { savedProject = { ...savedProject, ...JSON.parse(String(init.body)), version: 2 }; return savedProject as never; }
      return { ...task, ...JSON.parse(String(init.body)), version: 2 } as never;
    }
    return [] as never;
  });
});

afterEach(async () => {
  cleanup();
  await Promise.all([...queryClients].map(client => client.cancelQueries()));
  for (const client of queryClients) client.clear();
  queryClients.clear();
});

describe("项目与任务表格编辑", () => {
  it("仅为项目参与人的普通用户，无项目read权限时仍能选择API返回的创建任务项目", async () => {
    const fallback = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/supervision/options") return {
        users: [{ id: "user-2", label: "员工二" }], departments: [{ id: "dept-1", name: "部门一" }],
        // user-2 is in project.participantIds, but is neither owner nor supervisor.
        projects: [{ id: project.id, projectCode: project.projectCode, projectName: project.projectName, lifecycleStatus: project.lifecycleStatus }]
      } as never;
      return fallback(path, init);
    });
    renderPage(<SupervisionTasksPage />, { sub: "user-2", username: "participant", permissions: ["supervision-tasks:*:read", "supervision-tasks:*:create"] });
    fireEvent.click(await screen.findByRole("button", { name: /创建任务/ }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText("所属督办项目");
    fireEvent.mouseDown(select);
    const option = await screen.findByText("SP-001 · 项目甲", { selector: ".ant-select-item-option-content" });
    fireEvent.click(option);
    expect(within(dialog).getByText("SP-001 · 项目甲", { selector: ".ant-select-selection-item" })).toBeInTheDocument();
    expect(project.participantIds).toContain("user-2");
    expect(project.ownerId).not.toBe("user-2");
  });

  it("项目和任务标准业务页不渲染长期解释性副标题", async () => {
    renderPage(<SupervisionProjectsPage />, { sub: "user-1", username: "worker", permissions: permissions("supervision-projects") });
    expect(await screen.findByText("项目甲")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^项目管理$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("默认聚焦未完成督办项目；已完成和已中止项目保留用于历史查询。", { exact: false })).not.toBeInTheDocument();
    cleanup();
    renderPage(<SupervisionTasksPage />, { sub: "user-1", username: "worker", permissions: permissions("supervision-tasks") });
    expect(await screen.findByText("任务甲")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^任务管理$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("以督办任务为维度跟踪任务负责人、预计交付日期、当前进度与最新进展。", { exact: false })).not.toBeInTheDocument();
  });

  it("甘特图和风险卡片按日历日期显示，不暴露 ISO 时间戳", async () => {
    renderPage(<SupervisionProjectDashboardPage />, { sub: "user-1", username: "worker", permissions: [...permissions("supervision-project-dashboard", false), ...permissions("supervision-projects", false)] });
    expect(await screen.findByText("2026-09-21 → 2026-09-30")).toBeInTheDocument();
    expect(screen.getByText("即将到期 · 交付 2026-09-30 · 进度 0%")).toBeInTheDocument();
    expect(screen.queryByText(/T00:00:00\.000Z/)).not.toBeInTheDocument();
  });

  it("三个标准大屏直接进入业务内容，不渲染重复标题或用途说明", () => {
    const cases = [
      { page: <SupervisionProjectDashboardPage />, title: "项目管理大屏", description: "管理层查看督办项目总体进度、交付风险与计划时间轴。" },
      { page: <SupervisionEmployeeDashboardPage />, title: "员工待办大屏", description: "每天查看本人负责或协作的督办任务，及时更新进展并处理延期事项。" },
      { page: <SupervisionOwnerReportPage />, title: "责任人任务完成报表", description: "固定按任务截止日期落入统计周期；已中止任务不进入绩效分母。点击责任人可下钻同口径任务。" }
    ];
    for (const item of cases) {
      const view = renderPage(item.page, { sub: "user-1", username: "worker", permissions: [...permissions("supervision-project-dashboard", false), ...permissions("supervision-employee-dashboard", false), ...permissions("supervision-owner-report", false), ...permissions("supervision-projects", false), ...permissions("supervision-tasks", false)] });
      const main = within(view.container.querySelector(".supervision-dashboard-page")!);
      expect(main.queryByRole("heading", { name: new RegExp(`^${item.title}$`) })).not.toBeInTheDocument();
      expect(main.queryByText(item.description, { exact: false })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("browse mode is readonly, then project text editing autosaves with expectedVersion", async () => {
    renderPage(<SupervisionProjectsPage />, { sub: "user-1", username: "worker", permissions: permissions("supervision-projects") });
    expect(await screen.findByText("项目甲")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("项目甲")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /进入编辑模式/ }));
    const input = await screen.findByDisplayValue("项目甲");
    fireEvent.change(input, { target: { value: "项目乙" } }); fireEvent.blur(input);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/supervision/projects/project-1", expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"expectedVersion":1') })));
    expect(await screen.findByDisplayValue("项目乙")).toBeInTheDocument();
  });

  it("does not expose editing without field update permission and rolls back a failed task save", async () => {
    renderPage(<SupervisionTasksPage />, { sub: "user-1", username: "worker", permissions: permissions("supervision-tasks", false) });
    expect(await screen.findByText("任务甲")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入编辑模式" })).not.toBeInTheDocument();

    cleanup();
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/supervision/options") return { users: [{ id: "user-1", label: "员工一" }], departments: [{ id: "dept-1", name: "部门一" }], projects: [] } as never;
      if (path === "/table-filters/resources") return [{ code: "supervision-tasks", filterableFields: [] }] as never;
      if (path.startsWith("/table-filters/rows?resource=supervision-tasks")) return { rows: [task], total: 1, page: 1, pageSize: 50 } as never;
      if (init?.method === "PATCH") throw new Error("字段保存失败");
      return [] as never;
    });
    renderPage(<SupervisionTasksPage />, { sub: "user-1", username: "worker", permissions: permissions("supervision-tasks") });
    fireEvent.click(await screen.findByRole("button", { name: /进入编辑模式/ }));
    const input = await screen.findByDisplayValue("任务甲");
    fireEvent.change(input, { target: { value: "任务乙" } }); fireEvent.blur(input);
    await waitFor(() => expect(screen.getByDisplayValue("任务甲")).toBeInTheDocument());
  });
});

describe("项目与任务顶部安全删除", () => {
  const deleteRequests = () => vi.mocked(api).mock.calls.filter(([, init]) => init?.method === "DELETE");
  const selectRow = (container: HTMLElement, id: string) => fireEvent.click(container.querySelector(`tr[data-row-key="${id}"] input[type="checkbox"]`)!);
  const confirm = async () => {
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog.querySelector(".ant-modal-confirm-btns .ant-btn-primary")!);
  };

  it.each(["projects", "tasks"] as const)("%s: no delete action hides the button, including when only the other table grants deletion", async kind => {
    const resource = `supervision-${kind}`, other = kind === "projects" ? "tasks" : "projects";
    renderPage(kind === "projects" ? <SupervisionProjectsPage /> : <SupervisionTasksPage />, { permissions: [...permissions(resource), `supervision-${other}:*:delete`] });
    await screen.findByText(kind === "projects" ? project.projectCode : task.taskCode);
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument(); expect(deleteRequests()).toHaveLength(0);
  });
  it.each([{ isSystemAdmin: true }, { moduleAdminCodes: ["project-task"] }])("existing administrator grants show the toolbar delete: %j", async grant => {
    renderPage(<SupervisionProjectsPage />, { permissions: [], ...grant }); await screen.findByText(project.projectCode);
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
  });
  it.each(["projects", "tasks"] as const)("%s: readonly browsing can select, confirmation names the record, cancellation does not delete", async kind => {
    const row = kind === "projects" ? project : task;
    const view = renderPage(kind === "projects" ? <SupervisionProjectsPage /> : <SupervisionTasksPage />, { permissions: [...permissions(`supervision-${kind}`, false), `supervision-${kind}:*:delete`] });
    await screen.findByText(kind === "projects" ? project.projectCode : task.taskCode);
    const button = screen.getByRole("button", { name: "删除" }); expect(button).toBeDisabled(); selectRow(view.container, row.id); expect(button).toBeEnabled();
    expect(view.container.querySelector("section")?.getAttribute("data-edit-mode")).toBe("readonly");
    fireEvent.click(button); const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(`确认删除选中的 1 个${kind === "projects" ? "项目" : "任务"}`); expect(dialog).toHaveTextContent(kind === "projects" ? project.projectCode : task.taskCode);
    expect(dialog).toHaveTextContent("不会级联删除"); fireEvent.click(within(dialog).getByRole("button", { name: /取.*消/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(deleteRequests()).toHaveLength(0);
  });
  it("single project delete sends expectedVersion, refreshes dependencies and removes successful selection", async () => {
    const original = vi.mocked(api).getMockImplementation()!; let deleted = false;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (init?.method === "DELETE") { deleted = true; return { deleted: true } as never; }
      if (path.startsWith("/table-filters/rows?resource=supervision-projects") && deleted) return { rows: [], total: 0 } as never;
      return original(path, init);
    });
    const view = renderPage(<SupervisionProjectsPage />, { permissions: [...permissions("supervision-projects", false), "supervision-projects:*:delete"] });
    for (const key of ["supervision-tasks", "supervision-project-dashboard", "supervision-employee-dashboard", "supervision-owner-report", "supervision-owner-drill"]) view.client.setQueryData([key, "fixture"], {});
    view.client.setQueryData(["unrelated-module"], {});
    await screen.findByText(project.projectCode); selectRow(view.container, project.id); fireEvent.click(screen.getByRole("button", { name: "删除" })); await confirm();
    await waitFor(() => expect(deleteRequests()).toHaveLength(1)); expect(deleteRequests()[0]).toEqual(["/supervision/projects/project-1?expectedVersion=1", { method: "DELETE" }]);
    await waitFor(() => expect(screen.queryByText(project.projectCode)).not.toBeInTheDocument()); expect(screen.queryByText("已选 1/1")).not.toBeInTheDocument();
    for (const key of ["supervision-tasks", "supervision-project-dashboard", "supervision-employee-dashboard", "supervision-owner-report", "supervision-owner-drill"]) expect(view.client.getQueryState([key, "fixture"])?.isInvalidated).toBe(true);
    expect(view.client.getQueryState(["unrelated-module"])?.isInvalidated).toBe(false);
  });
  it("multiple tasks: confirms both codes, reports success/failure and preserves failed selection and reason", async () => {
    const original = vi.mocked(api).getMockImplementation()!;
    const blocked = { ...task, id: "task-2", taskCode: "ST-002", taskName: "任务乙", version: 3 }; let deleted = false;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (init?.method === "DELETE") { if (path.includes("task-2")) throw new Error("任务存在进展历史，不能删除"); deleted = true; return { deleted: true } as never; }
      if (path.startsWith("/table-filters/rows?resource=supervision-tasks")) return { rows: deleted ? [blocked] : [task, blocked], total: deleted ? 1 : 2 } as never;
      return original(path, init);
    });
    const view = renderPage(<SupervisionTasksPage />, { permissions: [...permissions("supervision-tasks", false), "supervision-tasks:*:delete"] });
    await screen.findByText("ST-002"); selectRow(view.container, task.id); selectRow(view.container, blocked.id); fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("确认删除选中的 2 个任务？ST-001、ST-002"); await confirm();
    await waitFor(() => expect(deleteRequests()).toHaveLength(2)); expect(deleteRequests()[1]![0]).toBe("/supervision/tasks/task-2?expectedVersion=3");
    expect(await screen.findByText(/成功 1 条，失败 1 条。ST-002：任务存在进展历史/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("ST-001")).not.toBeInTheDocument()); expect(view.container.querySelector('tr[data-row-key="task-2"] input[type="checkbox"]')).toBeChecked();
  });
  it("all failures preserve rows and never announce success", async () => {
    const original = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, init) => { if (init?.method === "DELETE") throw new Error("数据已被其他人修改，请刷新后重试"); return original(path, init); });
    const view = renderPage(<SupervisionTasksPage />, { permissions: [...permissions("supervision-tasks", false), "supervision-tasks:*:delete"] });
    await screen.findByText(task.taskCode); selectRow(view.container, task.id); fireEvent.click(screen.getByRole("button", { name: "删除" })); await confirm();
    expect(await screen.findByText(/成功 0 条，失败 1 条。ST-001：数据已被其他人修改/)).toBeInTheDocument(); expect(view.container.querySelector('tr[data-row-key="task-1"] input[type="checkbox"]')).toBeChecked();
  });
});


describe("项目变更与创建任务候选缓存一致性", () => {
  const session = { sub: "user-2", permissions: [...permissions("supervision-projects"), "supervision-projects:*:create", "supervision-tasks:*:read", "supervision-tasks:*:create"] };
  const candidate = { id: project.id, projectCode: project.projectCode, projectName: project.projectName, lifecycleStatus: project.lifecycleStatus };
  const dependencies = ["supervision-projects", "supervision-options", "supervision-tasks", "supervision-task-progress", "supervision-project-dashboard", "supervision-employee-dashboard", "supervision-owner-report", "supervision-owner-drill"];
  const seedDependencies = (client: QueryClient) => {
    for (const key of dependencies) client.setQueryData([key, "dependency-test"], { rows: [], total: 0 });
    client.setQueryData(["unrelated-module", "dependency-test"], {});
  };
  const expectDependenciesInvalidated = (client: QueryClient) => {
    for (const key of dependencies) expect(client.getQueryState([key, "dependency-test"])?.isInvalidated, key).toBe(true);
    expect(client.getQueryState(["unrelated-module", "dependency-test"])?.isInvalidated).toBe(false);
  };
  const optionsRequests = () => vi.mocked(api).mock.calls.filter(([path]) => path === "/supervision/options").length;
  const openProjectSelect = async () => {
    const dialog = await screen.findByRole("dialog");
    fireEvent.mouseDown(within(dialog).getByLabelText("所属督办项目"));
    return dialog;
  };

  it("同浏览器inline改名刷新全部项目依赖，切换任务页后显示新名称", async () => {
    const original = vi.mocked(api).getMockImplementation()!; let current = { ...candidate };
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === "/supervision/options") return { users: [], departments: [], projects: [current] } as never;
      const saved = await original(path, init);
      if (path === "/supervision/projects/project-1" && init?.method === "PATCH") current = { ...current, ...JSON.parse(String(init.body)) };
      return saved;
    });
    const view = renderPage(<SupervisionProjectsPage />, session);
    await screen.findByText("项目甲"); seedDependencies(view.client);
    await waitFor(() => expect(view.client.getQueryData(["supervision-options"])).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /进入编辑模式/ }));
    const input = await screen.findByDisplayValue("项目甲"); fireEvent.change(input, { target: { value: "项目乙" } }); fireEvent.blur(input);
    await screen.findByDisplayValue("项目乙");
    await waitFor(() => expect((view.client.getQueryData(["supervision-options"]) as any).projects[0].projectName).toBe("项目乙"));
    expectDependenciesInvalidated(view.client);
    cleanup(); renderPage(<SupervisionTasksPage />, session, view.client);
    fireEvent.click(await screen.findByRole("button", { name: /创建任务/ })); await openProjectSelect();
    expect(await screen.findByText("SP-001 · 项目乙", { selector: ".ant-select-item-option-content" })).toBeInTheDocument();
    expect(screen.queryByText("SP-001 · 项目甲", { selector: ".ant-select-item-option-content" })).not.toBeInTheDocument();
  });

  it("跨浏览器修改后，打开创建窗口强制重取仍在五分钟fresh期内的候选", async () => {
    const original = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, init) => path === "/supervision/options" ? { users: [], departments: [], projects: [{ ...candidate, projectName: "项目乙" }] } as never : original(path, init));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["supervision-options"], { users: [], departments: [], projects: [candidate] });
    renderPage(<SupervisionTasksPage />, session, client); await screen.findByText(task.taskCode);
    expect(optionsRequests()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /创建任务/ })); await openProjectSelect();
    expect(optionsRequests()).toBe(1);
    expect(await screen.findByText("SP-001 · 项目乙", { selector: ".ant-select-item-option-content" })).toBeInTheDocument();
  });

  it("刷新候选失败时明确提示、不打开旧窗口；再次点击可以重试", async () => {
    const original = vi.mocked(api).getMockImplementation()!; let failing = true;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === "/supervision/options") { if (failing) throw Error("HTTP 503"); return { users: [], departments: [], projects: [candidate] } as never; }
      return original(path, init);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["supervision-options"], { users: [], departments: [], projects: [candidate] });
    renderPage(<SupervisionTasksPage />, session, client); await screen.findByText(task.taskCode);
    fireEvent.click(screen.getByRole("button", { name: /创建任务/ }));
    expect(await screen.findByText("项目候选加载失败，请重试")).toBeInTheDocument(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    failing = false; fireEvent.click(screen.getByRole("button", { name: /创建任务/ })); await openProjectSelect();
    expect(await screen.findByText("SP-001 · 项目甲", { selector: ".ant-select-item-option-content" })).toBeInTheDocument();
  });

  it("候选请求未完成时不开窗，连续点击只发出一次刷新", async () => {
    const original = vi.mocked(api).getMockImplementation()!; let resolveOptions!: (value: any) => void;
    const pending = new Promise(resolve => { resolveOptions = resolve; });
    vi.mocked(api).mockImplementation(async (path, init) => path === "/supervision/options" ? pending as never : original(path, init));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["supervision-options"], { users: [], departments: [], projects: [candidate] });
    renderPage(<SupervisionTasksPage />, session, client); await screen.findByText(task.taskCode);
    const button = screen.getByRole("button", { name: /创建任务/ }); fireEvent.click(button); fireEvent.click(button);
    expect(optionsRequests()).toBe(1); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    resolveOptions({ users: [], departments: [], projects: [{ ...candidate, projectName: "最新项目" }] }); await openProjectSelect();
    expect(await screen.findByText("SP-001 · 最新项目", { selector: ".ant-select-item-option-content" })).toBeInTheDocument();
  });

  it.each(["加入参与人", "移除参与人", "完成", "中止", "删除", "新增"])("他人%s后再次创建任务使用最新候选，不保留旧项目", async change => {
    const original = vi.mocked(api).getMockImplementation()!;
    let latest = [candidate];
    vi.mocked(api).mockImplementation(async (path, init) => path === "/supervision/options" ? { users: [], departments: [], projects: latest } as never : original(path, init));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const absent = ["加入参与人", "新增"].includes(change);
    client.setQueryData(["supervision-options"], { users: [], departments: [], projects: absent ? [] : [candidate] });
    renderPage(<SupervisionTasksPage />, session, client); await screen.findByText(task.taskCode);
    latest = absent ? [candidate] : [];
    fireEvent.click(screen.getByRole("button", { name: /创建任务/ })); await openProjectSelect();
    expect(optionsRequests()).toBe(1);
    if (absent) expect(await screen.findByText("SP-001 · 项目甲", { selector: ".ant-select-item-option-content" })).toBeInTheDocument();
    else expect(screen.queryByText("SP-001 · 项目甲", { selector: ".ant-select-item-option-content" })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Cancel|取.*消/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Reopening also refetches even when the preceding response is still fresh.
    fireEvent.click(screen.getByRole("button", { name: /创建任务/ })); await screen.findByRole("dialog"); expect(optionsRequests()).toBe(2);
  });

  it.each(["complete", "abort"] as const)("项目%s成功后复用统一依赖失效", async action => {
    const view = renderPage(<SupervisionProjectsPage />, session); await screen.findByText(project.projectCode); seedDependencies(view.client);
    fireEvent.click(screen.getByRole("button", { name: /进入编辑模式/ })); fireEvent.click(await screen.findByRole("button", { name: "项目操作-SP-001" }));
    fireEvent.click(await screen.findByText(action === "complete" ? "完成项目" : "中止项目", { selector: ".ant-dropdown-menu-title-content" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(action === "complete" ? "完成说明" : "中止原因"), { target: { value: "合成验收原因" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /OK|确.*定/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/supervision/projects/project-1/${action}`, expect.objectContaining({ method: "POST" })));
    await waitFor(() => expectDependenciesInvalidated(view.client));
  });

  it("项目编辑弹窗保存后刷新全部依赖", async () => {
    const view = renderPage(<SupervisionProjectsPage />, session); await screen.findByText(project.projectCode); seedDependencies(view.client);
    fireEvent.click(screen.getByRole("button", { name: /进入编辑模式/ })); fireEvent.click(await screen.findByRole("button", { name: "项目操作-SP-001" }));
    fireEvent.click(await screen.findByText("编辑项目", { selector: ".ant-dropdown-menu-title-content" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("项目名称"), { target: { value: "编辑后的项目" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /OK|确.*定/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/supervision/projects/project-1", expect.objectContaining({ method: "PATCH" })));
    await waitFor(() => expectDependenciesInvalidated(view.client));
  });

  it("写入成功但关联查询失败只提示刷新失败，不把已保存的改名回滚", async () => {
    const original = vi.mocked(api).getMockImplementation()!; let saved = false; let latest = { ...project };
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === "/supervision/options" && saved) throw Error("查询不可用");
      if (path.startsWith("/table-filters/rows?resource=supervision-projects")) return { rows: [latest], total: 1 } as never;
      if (init?.method === "PATCH") { latest = { ...latest, ...JSON.parse(String(init.body)), version: 2 }; saved = true; return latest as never; }
      return original(path, init);
    });
    const view = renderPage(<SupervisionProjectsPage />, session); await screen.findByText(project.projectCode);
    // The shared table debounces its initial status filter by 250ms; finish that initial read before editing.
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path]) => path.startsWith("/table-filters/rows?resource=supervision-projects") && path.includes("filterGroup="))).toBe(true));
    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    fireEvent.click(screen.getByRole("button", { name: /进入编辑模式/ }));
    const input = await screen.findByDisplayValue("项目甲"); fireEvent.change(input, { target: { value: "项目乙" } }); fireEvent.blur(input);
    expect(await screen.findByText("关联页面刷新失败，请点击刷新重试")).toBeInTheDocument();

    await waitFor(() => expect(within(view.container).getByDisplayValue("项目乙")).toBeInTheDocument());
  });
});
