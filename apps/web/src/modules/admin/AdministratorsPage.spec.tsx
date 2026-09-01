import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { AdministratorsPage } from "./AdministratorsPage";

vi.mock("../../api", () => ({ api: vi.fn() }));

const response = {
  modules: [{ code: "planning", label: "PMC中心" }, { code: "marketing", label: "营销中心" }],
  capabilities: { canManageSystemAdministrators: true, canManageModuleAdministrators: true },
  users: [
    { id: "admin-1", username: "admin", displayName: "系统管理员", enabled: true, departmentPaths: [], grant: { id: "grant-1", systemAdmin: true, moduleCodes: [], version: 1 } },
    { id: "user-1", username: "01382", displayName: "吴志琴", employeeNo: "01382", enabled: true, departmentPaths: [["凯南", "PMC中心"]], grant: null }
  ]
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><AdministratorsPage /></QueryClientProvider>);
}

async function openModuleAdministratorEditor() {
  await screen.findByText("默认账号");
  fireEvent.click(screen.getByRole("tab", { name: "模块管理员" }));
  fireEvent.click(screen.getByRole("button", { name: /添加模块管理员/ }));
  const dialog = await screen.findByRole("dialog", { name: "添加模块管理员" });
  const selectors = dialog.querySelectorAll(".ant-select-selector");
  fireEvent.mouseDown(selectors[0]!);
  fireEvent.click(await screen.findByText("吴志琴（01382）", { selector: ".ant-select-item-option-content" }));
  fireEvent.mouseDown(selectors[1]!);
  fireEvent.click(await screen.findByText("PMC中心", { selector: ".ant-select-item-option-content" }));
  return dialog;
}

describe("AdministratorsPage", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(api).mockImplementation(async (path) => path === "/admin/administrators" ? response as never : {} as never);
  });
  afterEach(() => cleanup());

  it("shows two simple tabs and keeps module administrators empty by default", async () => {
    renderPage();
    expect(await screen.findByRole("tab", { name: "系统管理员" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "模块管理员" })).toBeInTheDocument();
    expect(await screen.findByText("默认账号")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "模块管理员" }));
    expect(screen.queryByText("吴志琴")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加模块管理员/ })).toBeInTheDocument();
  });

  it("saves a module administrator once even when confirm is clicked twice", async () => {
    let resolveSave!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveSave = resolve; });
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === "/admin/administrators") return response as never;
      if (path === "/admin/administrators/user-1" && init?.method === "PUT") return await pending as never;
      return {} as never;
    });
    renderPage();
    const dialog = await openModuleAdministratorEditor();
    const save = within(dialog).getByRole("button", { name: /保\s*存/ });
    fireEvent.click(save); fireEvent.click(save);
    await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([path, init]) => path === "/admin/administrators/user-1" && init?.method === "PUT")).toHaveLength(1));
    expect(JSON.parse(String(vi.mocked(api).mock.calls.find(([path]) => path === "/admin/administrators/user-1")?.[1]?.body))).toMatchObject({ systemAdmin: false, moduleCodes: ["planning"], expectedVersion: null });
    resolveSave({ userId: "user-1" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加模块管理员" })).not.toBeInTheDocument());
  });

  it("renders both administrator lists as view-only when capabilities are absent", async () => {
    const readonly = {
      ...response,
      capabilities: { canManageSystemAdministrators: false, canManageModuleAdministrators: false },
      users: [...response.users, { id: "module-1", username: "module", displayName: "模块管理员甲", enabled: true, departmentPaths: [], grant: { id: "grant-2", systemAdmin: false, moduleCodes: ["planning"], version: 1 } }]
    };
    vi.mocked(api).mockImplementation(async (path) => path === "/admin/administrators" ? readonly as never : {} as never);
    renderPage();
    await screen.findByText("默认账号");
    expect(screen.queryByRole("button", { name: /添加系统管理员/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "模块管理员" }));
    expect(await screen.findByText("模块管理员甲")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /添加模块管理员/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("仅查看").length).toBeGreaterThan(0);
  });
});
