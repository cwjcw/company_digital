import { hasSupervisionFieldPermission, hasSupervisionPermission, supervisionScopeClause, taskCreationProjectScopeClause } from "./supervision.scope";
import type { SupervisionActor } from "./supervision.types";

const actor = (overrides: Partial<SupervisionActor> = {}): SupervisionActor => ({
  tenantId: "TENANT-A", userId: "0199aa00-0000-7000-8000-000000000001", username: "员工A", permissions: ["supervision-tasks:*:read"],
  tableDataScopes: [], requestId: "request-1", ...overrides
});

describe("任务督办数据范围", () => {
  it("创建任务的项目关系规则独立于项目read权限和通用数据范围，租户与身份均参数化", () => {
    const userId = "user' OR 1=1 --";
    const params: unknown[] = ["existing-id"];
    const sql = taskCreationProjectScopeClause(actor({ userId, permissions: ["supervision-tasks:*:create"] }), "project", params);
    expect(sql).toContain("project.tenant_id=$2");
    expect(sql).toContain("NOT IN ('COMPLETED','ABORTED')");
    expect(sql).toContain("project.owner_id::text=$3 OR project.supervisor_id::text=$3 OR project.participant_ids ? $3");
    expect(sql).not.toContain(userId);
    expect(sql).not.toContain("created_by");
    expect(params).toEqual(["existing-id", "TENANT-A", userId]);
  });

  it.each([{ isSystemAdmin: true }, { moduleAdminCodes: ["project-task"] }, { permissions: ["*"] }])("管理员仍受tenant/未结束约束：%j", (overrides) => {
    const params: unknown[] = [];
    const sql = taskCreationProjectScopeClause(actor(overrides), "project", params);
    expect(sql).toContain("project.tenant_id=$1");
    expect(sql).toContain("NOT IN ('COMPLETED','ABORTED')");
    expect(sql).not.toContain("owner_id");
    expect(params).toEqual(["TENANT-A"]);
  });

  it("无task create权限、缺少用户身份或其它模块管理员均不扩大范围", () => {
    expect(taskCreationProjectScopeClause(actor(), "project", [])).toBe("1=0");
    expect(taskCreationProjectScopeClause(actor({ userId: null, permissions: ["supervision-tasks:*:create"] }), "project", [])).toBe("1=0");
    expect(taskCreationProjectScopeClause(actor({ moduleAdminCodes: ["planning"] }), "project", [])).toBe("1=0");
  });

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

describe("supervision delete scope stays in its own module", () => {
  it("a Planning administrator with an explicit delete action still needs a supervision data scope", () => {
    const viewer: any = { tenantId: "A", userId: "user", permissions: ["supervision-tasks:*:delete"], moduleAdminCodes: ["planning"], tableDataScopes: [] };
    expect(supervisionScopeClause(viewer, "supervision-tasks", "delete", "record", [])).toBe("1=0");
  });
});
