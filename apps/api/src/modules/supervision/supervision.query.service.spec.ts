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

describe("创建任务的项目候选", () => {
  it("仅有任务create且没有任何项目read scope也查询业务候选，只投影四个最小字段", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new SupervisionQueryService({ transaction: (work: any) => work({ query }) } as never, { listEnabled: async () => [] } as never);
    await service.options(actor(["supervision-tasks:*:create"]));
    const call = query.mock.calls.find(([sql]) => sql.includes("FROM supervision_projects"));
    expect(call).toBeDefined();
    expect(call![0].split(" FROM ")[0]).toBe('SELECT id,project_code "projectCode",project_name "projectName",lifecycle_status "lifecycleStatus"');
    expect(call![0]).toContain("project.participant_ids ? $2");
    expect(call![1]).toEqual(["TENANT-A", actor([]).userId]);
  });

  it("仅有项目read权限不会获得创建任务候选", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new SupervisionQueryService({ transaction: (work: any) => work({ query }) } as never, {} as never);
    expect((await service.options(actor(["supervision-projects:*:read"]))).projects).toEqual([]);
    expect(query.mock.calls.some(([sql]) => sql.includes("FROM supervision_projects"))).toBe(false);
  });
});
