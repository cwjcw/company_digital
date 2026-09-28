import { hasSupervisionFieldPermission, hasSupervisionPermission, supervisionScopeClause } from "./supervision.scope";
import type { SupervisionActor } from "./supervision.types";

const actor = (overrides: Partial<SupervisionActor> = {}): SupervisionActor => ({
  tenantId: "TENANT-A", userId: "0199aa00-0000-7000-8000-000000000001", username: "员工A", permissions: ["supervision-tasks:*:read"],
  tableDataScopes: [], requestId: "request-1", ...overrides
});

describe("任务督办数据范围", () => {
  it("只读权限不能借用为编辑权限，字段权限也独立判定", () => {
    const readOnly = actor({ permissions: ["supervision-tasks:*:read", "supervision-tasks:taskName:read"] });
    expect(hasSupervisionPermission(readOnly, "supervision-tasks", "read")).toBe(true);
    expect(hasSupervisionPermission(readOnly, "supervision-tasks", "update")).toBe(false);
    expect(hasSupervisionFieldPermission(readOnly, "supervision-tasks", "taskName", "read")).toBe(true);
    expect(hasSupervisionFieldPermission(readOnly, "supervision-tasks", "taskName", "update")).toBe(false);
  });

  it("没有数据范围时拒绝读取，即使知道记录 ID 也不能放行", () => {
    const params: unknown[] = ["TENANT-A"];
    expect(supervisionScopeClause(actor(), "supervision-tasks", "read", "record", params)).toBe("1=0");
  });

  it("OWN 保持平台语义，只匹配本人创建数据", () => {
    const params: unknown[] = ["TENANT-A"];
    const sql = supervisionScopeClause(actor({ tableDataScopes: [{ resource: "supervision-tasks", scope: "OWN", actions: ["read"] }] }), "supervision-tasks", "read", "record", params);
    expect(sql).toContain("record.created_by");
    expect(sql).not.toContain("record.owner_id");
    expect(sql).not.toContain("record.collaborator_ids");
    expect(params).toContain("0199aa00-0000-7000-8000-000000000001");
  });

  it("CUSTOM ANY supports the related-person rule with member and multi-member fields", () => {
    const userId = "0199aa00-0000-7000-8000-000000000001";
    const params: unknown[] = ["TENANT-A"];
    const sql = supervisionScopeClause(actor({ tableDataScopes: [{ resource: "supervision-projects", scope: "CUSTOM", match: "ANY", actions: ["read"], rules: [
      { fieldKey: "ownerId", operator: "EQ", value: "CURRENT_USER" },
      { fieldKey: "supervisorId", operator: "EQ", value: "CURRENT_USER" },
      { fieldKey: "participantIds", operator: "CONTAINS", value: "CURRENT_USER" }
    ] }] }), "supervision-projects", "read", "record", params);
    expect(sql).toContain("record.owner_id::text =");
    expect(sql).toContain("record.supervisor_id::text =");
    expect(sql).toContain("record.participant_ids");
    expect(sql).toContain("? $");
    expect(params).toContain(userId);
  });

  it("CUSTOM 部门范围参数化且不会拼接用户输入", () => {
    const departmentId = "0199aa00-0000-7000-8000-000000000099";
    const params: unknown[] = ["TENANT-A"];
    const sql = supervisionScopeClause(actor({ tableDataScopes: [{ resource: "supervision-tasks", scope: "CUSTOM", match: "ALL", actions: ["read"], rules: [{ fieldKey: "departmentId", operator: "EQ", value: departmentId }] }] }), "supervision-tasks", "read", "record", params);
    expect(sql).toContain("record.department_id::text = $");
    expect(sql).not.toContain(departmentId);
    expect(params).toContain(departmentId);
  });

  it("不同 action 的范围不互相借用", () => {
    const params: unknown[] = ["TENANT-A"];
    expect(supervisionScopeClause(actor({ tableDataScopes: [{ resource: "supervision-tasks", scope: "ALL", actions: ["read"] }] }), "supervision-tasks", "update", "record", params)).toBe("1=0");
  });
});
