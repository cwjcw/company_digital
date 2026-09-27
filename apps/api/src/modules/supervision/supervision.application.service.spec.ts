import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { SupervisionApplicationService } from "./supervision.application.service";
import type { SupervisionActor } from "./supervision.types";

const actor = (permissions: string[] = []): SupervisionActor => ({
  tenantId: "TENANT-A", userId: "0199aa00-0000-7000-8000-000000000001", username: "员工A",
  permissions, tableDataScopes: [], requestId: "request-1"
});

describe("任务督办 Application Service 安全入口", () => {
  const service = new SupervisionApplicationService({} as any);

  it("无新增权限时在访问数据库前拒绝创建项目", () => {
    expect(() => service.createProject({} as any, actor())).toThrow(ForbiddenException);
  });

  it("无编辑权限时在访问数据库前拒绝更新任务", () => {
    expect(() => service.updateTask("0199aa00-0000-7000-8000-000000000002", {}, actor())).toThrow(ForbiddenException);
  });

  it("即使拥有编辑权限，普通 PATCH 仍不能静默修改任务截止日期", () => {
    expect(() => service.updateTask("0199aa00-0000-7000-8000-000000000002", { dueDate: "2026-10-01" }, actor(["supervision-tasks:*:update"])))
      .toThrow(BadRequestException);
  });

  it("普通 PATCH 不能覆盖任务进度，必须形成独立进展记录", () => {
    expect(() => service.updateTask("0199aa00-0000-7000-8000-000000000002", { progress: 50 }, actor(["supervision-tasks:*:update"])))
      .toThrow(BadRequestException);
  });

  it("项目当前进度只能由子任务派生，普通 PATCH 不能提交该字段", () => {
    expect(() => service.updateProject("0199aa00-0000-7000-8000-000000000002", { progress: 50 } as any, actor(["supervision-projects:*:update"])))
      .toThrow("项目当前进度由子任务自动计算，不能手动修改");
  });

  it("创建任务必须提供百分比当前进度，且保留创建时填写的值", async () => {
    const manager = {
      count: async () => 1,
      findOneBy: async () => ({ id: "0199aa00-0000-7000-8000-000000000003", enabled: true })
    };
    const input = {
      projectId: "0199aa00-0000-7000-8000-000000000002", taskName: "任务", description: "任务说明", ownerId: "0199aa00-0000-7000-8000-000000000001",
      collaboratorIds: ["0199aa00-0000-7000-8000-000000000001"], departmentId: "0199aa00-0000-7000-8000-000000000003", priority: "HIGH",
      plannedStartDate: "2026-09-27", dueDate: "2026-10-01", progress: 35.5, acceptanceCriteria: "验收标准"
    };
    await expect((service as any).taskInput(manager, { ...input, progress: undefined }, null)).rejects.toThrow("当前进度不能为空");
    await expect((service as any).taskInput(manager, input, null)).resolves.toMatchObject({ progress: "35.50" });
  });

  it("项目与任务都拒绝已经移除的紧急优先级", async () => {
    const departmentId = "0199aa00-0000-7000-8000-000000000003";
    const ownerId = "0199aa00-0000-7000-8000-000000000001";
    const manager = {
      count: async () => 1,
      findOneBy: async () => ({ id: departmentId, enabled: true })
    };
    await expect((service as any).projectInput(manager, {
      projectName: "项目", projectDescription: "项目说明", sourceType: "OTHER", ownerId, supervisorId: ownerId,
      participantIds: [ownerId], departmentId, priority: "URGENT", plannedStartDate: "2026-09-27", dueDate: "2026-10-01",
      acceptanceCriteria: "验收标准"
    })).rejects.toThrow("优先级无效");
    await expect((service as any).taskInput(manager, {
      projectId: "0199aa00-0000-7000-8000-000000000002", taskName: "任务", description: "任务说明", ownerId,
      collaboratorIds: [ownerId], departmentId, priority: "URGENT", plannedStartDate: "2026-09-27", dueDate: "2026-10-01",
      progress: 0, acceptanceCriteria: "验收标准"
    }, null)).rejects.toThrow("优先级无效");
  });

  it("项目督办人不在必填清单中，可以留空", async () => {
    const departmentId = "0199aa00-0000-7000-8000-000000000003";
    const ownerId = "0199aa00-0000-7000-8000-000000000001";
    const manager = {
      count: async () => 1,
      findOneBy: async () => ({ id: departmentId, enabled: true })
    };
    await expect((service as any).projectInput(manager, {
      projectName: "项目", projectDescription: "项目说明", sourceType: "OTHER", ownerId,
      participantIds: [ownerId], departmentId, priority: "HIGH", plannedStartDate: "2026-09-27", dueDate: "2026-10-01",
      acceptanceCriteria: "验收标准"
    })).resolves.toMatchObject({ supervisorId: null });
  });

  it("受控截止日期变更仍要求 dueDate 字段编辑权限", () => {
    expect(() => service.changeTaskDueDate("0199aa00-0000-7000-8000-000000000002", { dueDate: "2026-10-01", changeReason: "调整", expectedVersion: 1 }, actor(["supervision-tasks:*:update"])))
      .toThrow(ForbiddenException);
  });

  it("更新进展要求任务进度字段权限，不能只靠资源更新权限", () => {
    expect(() => service.addProgress({ taskId: "0199aa00-0000-7000-8000-000000000002", progress: 50, summary: "完成一半" }, actor(["supervision-tasks:*:update", "supervision-task-progress:*:create"])))
      .toThrow(ForbiddenException);
  });

  it("按 actor tenant 和数据范围校验记录，已知其他租户 ID 也不会被读取", async () => {
    let capturedSql = ""; let capturedParams: unknown[] = [];
    const manager = { query: async (sql: string, params: unknown[]) => { capturedSql = sql; capturedParams = params; return []; } };
    await expect((service as any).assertRecordScope(manager, "supervision_tasks", "supervision-tasks", "0199aa00-0000-7000-8000-000000000099", actor(), "read"))
      .rejects.toThrow("记录不存在或不在当前权限范围内");
    expect(capturedSql).toContain("record.tenant_id=$1");
    expect(capturedSql).toContain("record.id=$2::uuid");
    expect(capturedParams).toEqual(["TENANT-A", "0199aa00-0000-7000-8000-000000000099"]);
  });

  it("字段权限不能由资源 update 权限代替", async () => {
    const dataSource = { transaction: async (work: any) => work({
      query: async (sql: string) => sql.includes("SELECT 1 FROM supervision_tasks") ? [{ '?column?': 1 }] : [],
      createQueryBuilder: () => ({ setLock: () => ({ where: () => ({ getOne: async () => ({ id: "task", tenantId: "TENANT-A", projectId: "project", version: 1, lifecycleStatus: "IN_PROGRESS", dueDate: "2026-10-01", plannedStartDate: null, taskName: "任务", ownerId: "0199aa00-0000-7000-8000-000000000001", collaboratorIds: [], departmentId: null, priority: "MEDIUM", progress: "0", acceptanceCriteria: "标准", nextFollowupDate: null, attachments: [] }) }) }) }),
      count: async () => 1, findOneBy: async () => ({ id: "0199aa00-0000-7000-8000-000000000001", enabled: true })
    }) };
    const restricted = new SupervisionApplicationService(dataSource as any);
    await expect(restricted.updateTask("0199aa00-0000-7000-8000-000000000002", { taskName: "越权修改", expectedVersion: 1 }, actor(["supervision-tasks:*:update"])))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
