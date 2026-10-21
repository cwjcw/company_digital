import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationCenterPage } from "./NotificationCenterPage";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({ api: vi.fn(async (path: string) => path.startsWith("/notifications/events") ? [{ eventType: "equipment.status.fault_changed", label: "设备故障变化", moduleCode:"planning", module: "PMC中心", resource: "equipment-status-report", resourceLabel: "设备状态填报", condition: "故障时长发生变化且新值大于0时触发", channelLabel: "企业微信工作通知", recipientLabels: { EQUIPMENT_RESPONSIBLE: "设备责任人", FIXED_USERS: "指定人员" }, variables: ["equipmentCode"] }, {eventType:"finance.monthly.daily_summary",label:"财务月度数据每日汇总",moduleCode:"finance",module:"财务中心",resource:"finance-e10-monthly",resourceLabel:"月度数据",condition:"每天08:30汇总当月",channelLabel:"企业微信工作通知",recipientRules:["FIXED_USERS"],recipientLabels:{FIXED_USERS:"组织架构 / 角色 / 员工"},variables:["yearMonth","orderTotal"]}] : []) }));

describe("NotificationCenterPage", () => {
  afterEach(cleanup);
  it("offers the finance module returned by registered events",async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><NotificationCenterPage /></QueryClientProvider>);
    await screen.findByText(/月度数据 \/ finance.monthly.daily_summary/);
    fireEvent.mouseDown(screen.getByRole("combobox",{name:"模块"}));
    expect(await screen.findByText("财务中心")).toBeInTheDocument();
  });

  it("shows the three message-center tabs and registered event without the retired validation banner", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><NotificationCenterPage /></QueryClientProvider>);
    expect(screen.queryByText(/企业微信测试模式/)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "消息规则" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "发送记录" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "失败消息" })).toBeInTheDocument();
    expect(screen.getByText("新增规则")).toBeInTheDocument();
  });
});

describe("message rule recipient editor", () => {
  const event = { eventType: "finance.monthly.daily_summary", label: "财务月度数据每日汇总", moduleCode: "finance", module: "财务中心", resource: "finance-e10-monthly", resourceLabel: "月度数据", condition: "每天08:30", channelLabel: "企业微信工作通知", recipientRules: ["FIXED_USERS"], recipientLabels: { FIXED_USERS: "组织架构 / 角色 / 员工" }, variables: ["yearMonth"] };
  const initial = { id: "finance-rule", name: "财务月度数据每日汇总", eventType: event.eventType, resource: event.resource, module: event.module, recipientRule: "FIXED_USERS", recipientTargets: [] as any[], config: { template: "模板{yearMonth}" }, enabled: false, version: 1 };
  const options = { organizations: [{ id: "org", name: "测试组织", enabled: true, parentId: null, pathLabel: "测试组织" }], roles: [{ id: "role", name: "测试角色" }], users: [{ id: "user", displayName: "测试员工", username: "fixture", enabled: true }] };
  afterEach(cleanup);
  async function setup() {
    const { api } = await import("../../api");
    let row = structuredClone(initial); let reject: { status: number; details?: unknown; message: string } | undefined;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === "/notifications/events") return [event] as any;
      if (path === "/notifications/recipient-options") return options as any;
      if (init?.method === "PATCH") {
        if (reject) throw Object.assign(new Error(reject.message), reject);
        const body = JSON.parse(String(init.body)); row = { ...row, ...body, config: { ...row.config, template: body.template ?? row.config.template }, version: row.version + 1 }; return structuredClone(row) as any;
      }
      if (path === "/notifications/rules/finance-rule") return structuredClone(row) as any;
      return [structuredClone(row)] as any;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><NotificationCenterPage /></QueryClientProvider>);
    await screen.findByRole("button", { name: /编辑/ });
    return { api, row: () => row, reject: (e: typeof reject) => { reject = e; }, replace: (next: typeof row) => { row = next; } };
  }
  it("shows actionable missing recipients and opens the editor", async () => {
    const s = await setup(); s.reject({ status: 400, details: { code: "NOTIFICATION_RECIPIENTS_REQUIRED" }, message: "未配置有效接收人，请先编辑接收对象" });
    fireEvent.click(screen.getByRole("button", { name: "启用" }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑接收人" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("接收对象");
  });
  it("saves multiple target types, echoes fresh saved data and discards cancelled edits", async () => {
    const s = await setup();
    s.replace({ ...s.row(), recipientTargets: [{ type: "ORGANIZATION", organizationUnitId: "org", includeDescendants: true }, { type: "ROLE", roleId: "role" }] });
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("组织：测试组织"); expect(dialog).toHaveTextContent("角色：测试角色");
    fireEvent.click(within(dialog).getByRole("tab", { name: /员工/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /测试员工/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(s.row().recipientTargets).toHaveLength(3);
    expect(screen.getByText(/组织：测试组织（含下级）.*角色：测试角色.*员工：测试员工/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    let reopened = await screen.findByRole("dialog");
    expect(reopened).toHaveTextContent("员工：测试员工");
    fireEvent.change(within(reopened).getByLabelText("规则名称"), { target: { value: "未保存修改" } });
    fireEvent.click(within(reopened).getByRole("button", { name: /取\s*消/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /编辑/ })); reopened = await screen.findByRole("dialog");
    expect(within(reopened).getByLabelText("规则名称")).toHaveValue(initial.name);
    fireEvent.click(within(reopened).getByRole("tab", { name: /员工/ }));
    expect(within(reopened).getByRole("checkbox", { name: /测试员工/ })).toBeChecked();
    fireEvent.click(within(reopened).getByRole("checkbox", { name: /测试员工/ }));
    fireEvent.click(within(reopened).getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(s.row().recipientTargets).toHaveLength(2));
  });
  it("toggles using only state and version and displays the returned state immediately", async () => {
    const s = await setup(); fireEvent.click(screen.getByRole("button", { name: "启用" }));
    await screen.findByRole("button", { name: "停用" });
    expect(s.api).toHaveBeenCalledWith("/notifications/rules/finance-rule", expect.objectContaining({ body: JSON.stringify({ enabled: true, expectedVersion: 1 }) }));
    fireEvent.click(screen.getByRole("button", { name: "停用" })); await screen.findByRole("button", { name: "启用" });
    expect(s.row().config.template).toBe(initial.config.template);
  });
  it("shows save permission errors inside the editor and refreshes stale versions before retry", async () => {
    const s = await setup(); fireEvent.click(screen.getByRole("button", { name: /编辑/ })); await screen.findByRole("dialog");
    s.reject({ status: 403, message: "当前管理员无权管理该模块的消息规则" });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    expect(await screen.findByText("当前管理员无权管理该模块的消息规则")).toBeInTheDocument();
    s.reject({ status: 409, message: "规则已被其他用户修改，请刷新后重试" });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    s.replace({ ...s.row(), version: 2, name: "其他管理员保存" });
    fireEvent.click(await screen.findByRole("button", { name: "刷新后重试" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByLabelText("规则名称")).toHaveValue("其他管理员保存"));
    s.reject(undefined); fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(s.row().version).toBe(3);
  });
});
