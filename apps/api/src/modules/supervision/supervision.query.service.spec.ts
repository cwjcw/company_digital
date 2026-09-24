import { ForbiddenException } from "@nestjs/common";
import { SupervisionQueryService } from "./supervision.query.service";
import type { SupervisionActor } from "./supervision.types";

const actor = (permissions: string[]): SupervisionActor => ({
  tenantId: "TENANT-A", userId: "0199aa00-0000-7000-8000-000000000001", username: "员工A",
  permissions, tableDataScopes: [], requestId: "request-1"
});

describe("任务督办聚合查询的服务端搜索", () => {
  const service = new SupervisionQueryService({} as never, {} as never);

  it("员工任务快速搜索只使用有读取权限的字段并参数化关键词", () => {
    const params: unknown[] = ["TENANT-A"]; const clauses: string[] = [];
    (service as any).taskSearch("项目%' OR 1=1 --", actor(["supervision-tasks:taskName:read"]), params, clauses, "task");
    expect(clauses.join(" ")).toContain("task.task_name");
    expect(clauses.join(" ")).not.toContain("OR 1=1 --");
    expect(params[1]).toBe("%项目%' OR 1=1 --%");
  });

  it("没有任何可搜索字段权限时拒绝搜索", () => {
    expect(() => (service as any).taskSearch("关键词", actor([]), ["TENANT-A"], [], "task")).toThrow(ForbiddenException);
  });

  it("责任人报表搜索后再分页统计，且仅匹配有权限显示的责任人/部门", () => {
    const rows = [
      { ownerName: "张三", departmentName: "生产部", totalTasks: 3 },
      { ownerName: "李四", departmentName: "销售部", totalTasks: 2 }
    ];
    const result = (service as any).searchReportRows(rows, "生产", actor(["supervision-owner-report:departmentId:read"]));
    expect(result).toEqual([rows[0]]);
  });
});
