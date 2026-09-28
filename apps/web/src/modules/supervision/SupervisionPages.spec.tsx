import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { SupervisionProjectsPage, SupervisionTasksPage } from "./SupervisionPages";

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

function renderPage(page: React.ReactNode, session: Record<string, unknown>) {
  localStorage.setItem("sessionUser", JSON.stringify(session));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AntApp>{page}</AntApp></QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/supervision/options") return { users: [{ id: "user-1", label: "员工一" }, { id: "user-2", label: "员工二" }], departments: [{ id: "dept-1", name: "部门一" }], projects: [] } as never;
    if (path === "/table-filters/resources") return [{ code: "supervision-projects", filterableFields: [] }, { code: "supervision-tasks", filterableFields: [] }] as never;
    if (path.startsWith("/table-print/resources")) return [] as never;
    if (path.startsWith("/table-filters/rows?resource=supervision-projects")) return { rows: [project], total: 1, page: 1, pageSize: 50 } as never;
    if (path.startsWith("/table-filters/rows?resource=supervision-tasks")) return { rows: [task], total: 1, page: 1, pageSize: 50 } as never;
    if (init?.method === "PATCH") return { ...(path.includes("/projects/") ? project : task), ...JSON.parse(String(init.body)), version: 2 } as never;
    return [] as never;
  });
});

afterEach(() => cleanup());

describe("项目与任务表格编辑", () => {
  it("browse mode is readonly, then project text editing autosaves with expectedVersion", async () => {
    renderPage(<SupervisionProjectsPage />, { sub: "user-1", username: "worker", permissions: permissions("supervision-projects") });
    expect(await screen.findByText("项目甲")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("项目甲")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /进入编辑模式/ }));
    const input = await screen.findByDisplayValue("项目甲");
    fireEvent.change(input, { target: { value: "项目乙" } }); fireEvent.blur(input);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/supervision/projects/project-1", expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"expectedVersion":1') })));
    expect(screen.getByDisplayValue("项目乙")).toBeInTheDocument();
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
