import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource, type QueryRunner } from "typeorm";
import dataSource from "../../data-source";
import { AuthGuard } from "../../auth";
import { AuditLog, OrganizationUnit, SupervisionProject, SupervisionTask, User } from "../../entities";
import { OBJECT_STORAGE } from "../../storage/object-storage";
import { OrganizationDirectoryService } from "../organization-directory/organization-directory.service";
import { SupervisionApplicationService } from "./supervision.application.service";
import { SupervisionController } from "./supervision.controller";
import { SupervisionQueryService } from "./supervision.query.service";
import type { SupervisionActor } from "./supervision.types";

const integration = process.env.KDOS_POSTGRES_INTEGRATION === "true" ? describe : describe.skip;
const userId = "0199aa00-0000-7000-8000-000000000001";
const otherId = "0199aa00-0000-7000-8000-000000000002";
const departmentId = "0199aa00-0000-7000-8000-000000000003";
const tenantId = process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";
const employee = (): SupervisionActor => ({
  tenantId, userId, username: "participant-fixture", permissions: ["supervision-tasks:*:create"],
  tableDataScopes: [{ resource: "supervision-tasks", scope: "OWN", actions: ["create"] }], requestId: "task-creation-regression"
});

/** Real PostgreSQL JSONB/UUID SQL + both HTTP endpoints + real Application/audit.
 * All fixtures and writes use connection-local TEMP tables inside a rolled-back
 * transaction. No production row, credential or authorization is modified.
 * Only authentication is replaced by a fixture actor in this isolated test app.
 */
integration("创建任务项目关系授权（PostgreSQL + HTTP）", () => {
  let db: DataSource; let runner: QueryRunner; let app: INestApplication;
  let currentActor = employee();
  const projects: Record<string, SupervisionProject> = {};
  beforeAll(async () => {
    const options = dataSource.options;
    if (options.type !== "postgres") throw new Error("PostgreSQL integration requires PostgreSQL");
    db = new DataSource({ ...options, entities: [User, OrganizationUnit, SupervisionProject, SupervisionTask, AuditLog], subscribers: [], migrations: [], poolSize: 1 });
    await db.initialize(); runner = db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
    for (const table of ["users", "organization_units", "supervision_projects", "supervision_tasks", "audit_logs"]) {
      await runner.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS) ON COMMIT DROP`);
    }
    await runner.manager.save(User, [userId, otherId].map((id) => runner.manager.create(User, {
      id, tenantId, username: id, displayName: "Fixture", passwordHash: "not-a-login", enabled: true
    })));
    await runner.manager.save(OrganizationUnit, { id: departmentId, name: "Fixture", level: 1, enabled: true });
    const variants = [
      { key: "owner", ownerId: userId }, { key: "supervisor", supervisorId: userId },
      { key: "participant", participantIds: [otherId, userId] }, { key: "unrelated" },
      { key: "completed", participantIds: [userId], lifecycleStatus: "COMPLETED" },
      { key: "aborted", participantIds: [userId], lifecycleStatus: "ABORTED" },
      { key: "crossTenant", tenantId: tenantId + "-OTHER", ownerId: userId, supervisorId: userId, participantIds: [userId] }
    ];
    for (const [index, { key, ...overrides }] of variants.entries()) {
      projects[key] = await runner.manager.save(SupervisionProject, runner.manager.create(SupervisionProject, {
        id: `0199aa00-0000-7000-8000-00000000001${index}`, tenantId, projectCode: `SP-fixture-${key}`, projectName: key,
        ownerId: otherId, supervisorId: null, participantIds: [], departmentId, projectDescription: "Fixture",
        plannedStartDate: "2026-10-14", dueDate: "2026-10-31", lifecycleStatus: "IN_PROGRESS", acceptanceCriteria: "Fixture", ...overrides
      } as SupervisionProject));
    }
    const scoped = { transaction: (work: any) => runner.manager.transaction(work) } as DataSource;
    const module = await Test.createTestingModule({
      controllers: [SupervisionController], providers: [
        { provide: SupervisionApplicationService, useValue: new SupervisionApplicationService(scoped) },
        { provide: SupervisionQueryService, useValue: new SupervisionQueryService(scoped, new OrganizationDirectoryService(runner.manager.getRepository(OrganizationUnit))) },
        { provide: OBJECT_STORAGE, useValue: {} }
      ]
    }).overrideGuard(AuthGuard).useValue({ canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      req.user = { ...currentActor, sub: currentActor.userId }; req.requestId = currentActor.requestId; return true;
    } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1"); await app.init();
  }, 30000);
  beforeEach(() => { currentActor = employee(); });
  afterEach(async () => {
    await runner.query("DELETE FROM pg_temp.supervision_tasks");
    await runner.query("DELETE FROM pg_temp.audit_logs");
  });
  afterAll(async () => {
    await app?.close();
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    await runner?.release(); if (db?.isInitialized) await db.destroy();
  });
  const options = () => request(app.getHttpServer()).get("/api/v1/supervision/options");
  const create = (key: string) => request(app.getHttpServer()).post("/api/v1/supervision/tasks").send({
    projectId: projects[key].id, taskName: "授权回归测试", description: "Fixture", ownerId: userId, collaboratorIds: [userId],
    departmentId, priority: "MEDIUM", plannedStartDate: "2026-10-15", dueDate: "2026-10-31", progress: 0, acceptanceCriteria: "Fixture"
  });

  it("A-G：仅返回同租户未结束且本人负责/督办/参与的项目，且仅四个字段", async () => {
    const { body } = await options().expect(200);
    expect(body.projects.map((p: any) => p.id).sort()).toEqual([projects.owner.id, projects.supervisor.id, projects.participant.id].sort());
    for (const project of body.projects) expect(Object.keys(project).sort()).toEqual(["id", "projectCode", "projectName", "lifecycleStatus"].sort());
  });
  it.each(["owner", "supervisor", "participant"])("POST：%s无需项目read权限或scope即可创建并审计", async (key) => {
    const { body } = await create(key).expect(201);
    expect(body).toMatchObject({ projectId: projects[key].id, tenantId, createdBy: userId });
    expect(await runner.manager.count(SupervisionTask, { where: { projectId: projects[key].id } })).toBe(1);
    expect(await runner.manager.count(AuditLog, { where: { recordId: body.id, action: "supervision.task.created", actorId: userId } })).toBe(1);
  });
  it.each(["unrelated", "completed", "aborted", "crossTenant"])("POST：手工伪造%s项目ID被拒绝，且无任务/审计残留", async (key) => {
    await create(key).expect(404);
    expect(await runner.manager.count(SupervisionTask)).toBe(0);
    expect(await runner.manager.count(AuditLog)).toBe(0);
  });
  it.each([{ isSystemAdmin: true }, { moduleAdminCodes: ["project-task"] }])("H：管理员%j看到当前租户全部未结束项目并可创建", async (admin) => {
    Object.assign(currentActor, admin, { permissions: [], tableDataScopes: [] });
    const { body } = await options().expect(200);
    expect(body.projects.map((p: any) => p.id).sort()).toEqual(["owner", "supervisor", "participant", "unrelated"].map((key) => projects[key].id).sort());
    await create("unrelated").expect(201);
    await create("completed").expect(404); await create("aborted").expect(404); await create("crossTenant").expect(404);
  });
  it("项目read ALL不能让无关联人员创建；项目read OWN不能阻止参与人创建", async () => {
    currentActor.permissions.push("supervision-projects:*:read");
    currentActor.tableDataScopes.push({ resource: "supervision-projects", scope: "ALL", actions: ["read"] });
    await create("unrelated").expect(404);
    currentActor.tableDataScopes[1].scope = "OWN";
    const { body } = await options().expect(200);
    expect(body.projects.map((p: any) => p.id)).toContain(projects.participant.id);
    await create("participant").expect(201);
  });
  it("候选加载后关系移除/项目结束，POST重新校验并拒绝", async () => {
    expect((await options().expect(200)).body.projects.map((p: any) => p.id)).toContain(projects.participant.id);
    await runner.manager.update(SupervisionProject, projects.participant.id, { participantIds: [] });
    try { await create("participant").expect(404); }
    finally { await runner.manager.update(SupervisionProject, projects.participant.id, { participantIds: [otherId, userId] }); }
    await runner.manager.update(SupervisionProject, projects.owner.id, { lifecycleStatus: "COMPLETED" });
    try { await create("owner").expect(404); }
    finally { await runner.manager.update(SupervisionProject, projects.owner.id, { lifecycleStatus: "IN_PROGRESS" }); }
  });
  it("即使有关联但无task create权限，候选为空且POST403", async () => {
    currentActor.permissions = ["supervision-projects:*:read"];
    expect((await options().expect(200)).body.projects).toEqual([]);
    await create("participant").expect(403);
  });
});
