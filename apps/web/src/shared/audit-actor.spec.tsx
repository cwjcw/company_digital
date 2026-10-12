import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditPermissionFields, auditActorUserLabels, formatAuditActor } from "@kdos/contracts";
import { api } from "../api";
import { KdosDataTable } from "./KdosDataTable";
import { defaultOperatorFor, RuleValue, visibleOperators, emptyFilterGroup } from "./advanced-filter";
import { KdosColumnMenu } from "./table-column-menu";

vi.mock("../api", () => ({ api: vi.fn() }));
const users = [
  { id: "04ada40c-21aa-496b-941c-8c4c969c477b", username: "08977", displayName: "王家威", enabled: true },
  { id: "106dc309-f471-4959-a46b-5454089dcedd", username: "05989", displayName: "吴建修", enabled: true },
  { id: "9a846d7c-1605-4358-b4e4-617ef8f31dc9", username: "06359", displayName: "丁才春", enabled: true },
  { id: "b615038b-ba11-45ee-9175-d30bb599b77a", username: "06148", displayName: "李虹", enabled: true },
  { id: "c5d79e01-ef7e-4296-a874-0036bffa577d", username: "09417", displayName: "何辉", enabled: true },
  { id: "0199e000-0000-7000-8000-000000000001", username: "__kdos_system__", displayName: "KDOS系统任务", enabled: false }
];
const unknown = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const field = auditPermissionFields.find(f => f.key === "updatedBy")!;
const candidates = [...users.map(u => ({ value: u.id, label: u.displayName })), { value: unknown, label: "未知用户" }, { value: "system", label: "系统" }];

describe("公共Audit Actor展示与候选", () => {
  beforeEach(() => {
    localStorage.clear(); localStorage.setItem("sessionUser", JSON.stringify({ sub: "test", permissions: ["*"] }));
    vi.mocked(api).mockImplementation(async path => path === "/directory/users" ? users as never : path.startsWith("/table-filters/candidates")
      ? (path.includes("withMeta") ? { options: candidates, hasMore: false } : candidates) as never : [] as never);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it.each(["mps-process-reports", "mps-weekly-plans", "equipment-status-report", "supervision-tasks", "users"])("%s标准表与目录解析一致，不显示五个UUID/停用/未知UUID", async resource => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><KdosDataTable resource={resource} rowKey="id"
      columns={[{ title: "测试记录", dataIndex: "name" }]} dataSource={[...users.map((u, i) => ({ id: String(i), name: `记录${i}`, updatedBy: u.id, createdBy: "system" })),
        { id: "unknown", name: "未知", updatedBy: unknown }, { id: "system", name: "系统记录", updatedBy: "system" }]} /></QueryClientProvider>);
    await waitFor(() => users.forEach(u => expect(screen.getByText(u.displayName)).toBeInTheDocument()));
    expect(screen.getByText("未知用户")).toBeInTheDocument();
    expect(screen.getAllByText("系统").length).toBeGreaterThan(0);
    for (const value of [...users.map(u => u.id), unknown]) expect(document.body.textContent).not.toContain(value);
    client.clear();
  });

  it("两个审计字段优先eq身份候选；普通文本仍contains，普通member不被标记", () => {
    for (const f of auditPermissionFields.filter(f => f.format === "auditActor")) {
      expect(defaultOperatorFor(f)).toBe("eq");
      expect(visibleOperators(f).map(o => o.operator)).toEqual(["eq", "neq", "in", "not_in", "is_empty", "is_not_empty"]);
    }
    expect(defaultOperatorFor({ key: "remark", label: "备注", type: "text", editable: true })).toBe("contains");
    expect(formatAuditActor(unknown)).toBe("未知用户");
    expect(formatAuditActor("migration")).toBe("migration");
    expect(formatAuditActor("fallback", auditActorUserLabels([{ id: unknown, username: "fallback", displayName: "  " }]))).toBe("fallback");
  });

  it("高级筛选eq展示全部姓名并提交原UUID", async () => {
    const onChange = vi.fn();
    render(<RuleValue resource="mps-process-reports" field={field} operator="eq" rule={{ field: field.key, operator: "eq" }} onChange={onChange} />);
    await waitFor(() => expect(api).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole("combobox"));
    for (const user of users) expect(await screen.findByText(user.displayName)).toBeInTheDocument();
    expect(screen.getByText("未知用户")).toBeInTheDocument();
    expect(screen.getByText("系统")).toBeInTheDocument();
    for (const user of users) expect(document.body.textContent).not.toContain(user.id);
    fireEvent.click(screen.getByText("王家威"));
    expect(onChange).toHaveBeenLastCalledWith({ value: users[0]!.id });
  });

  it("列头候选也显示姓名，复选后提交真实actor值", async () => {
    const onFilter = vi.fn();
    render(<KdosColumnMenu title="更新人" resource="mps-process-reports" field={field} systemFixed pinned={false} filtered={false} rules={[]} tableSearch=""
      advancedGroup={emptyFilterGroup()} headerGroup={emptyFilterGroup()} filterable onSort={vi.fn()} onPin={vi.fn()} onHide={vi.fn()} onFilter={onFilter} />);
    fireEvent.click(screen.getByRole("button", { name: "更新人列菜单" }));
    fireEvent.click(await screen.findByRole("button", { name: /筛\s*选$/ }));
    const checkbox = await screen.findByRole("checkbox", { name: "王家威" });
    expect(screen.getByRole("checkbox", { name: "KDOS系统任务" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "未知用户" })).toBeInTheDocument();
    for (const user of users) expect(document.body.textContent).not.toContain(user.id);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: /^确\s*定$/ }));
    expect(onFilter).toHaveBeenCalledWith([{ field: "updatedBy", operator: "in", values: [users[0]!.id] }]);
  }, 15000);
});
