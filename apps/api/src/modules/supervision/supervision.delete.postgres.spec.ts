import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource, type QueryRunner } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { AuthGuard } from "../../auth";
import { AuditLog, SupervisionProject, SupervisionTask, SupervisionTaskProgress } from "../../entities";
import { OBJECT_STORAGE } from "../../storage/object-storage";
import { ProjectTaskSupervision1722920071000 } from "../../migrations/1722920071000-ProjectTaskSupervision";
import { SupervisionFormUsability1722920073000 } from "../../migrations/1722920073000-SupervisionFormUsability";
import { SupervisionApplicationService } from "./supervision.application.service";
import { SupervisionController } from "./supervision.controller";
import { SupervisionQueryService } from "./supervision.query.service";
import type { SupervisionActor } from "./supervision.types";

const socket = process.env.KDOS_SUPERVISION_DELETE_TEST_SOCKET;
const integration = socket ? describe : describe.skip;
const tenant = process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";
const user = "0199dd00-0000-7000-8000-000000000001";
const other = "0199dd00-0000-7000-8000-000000000002";
const administrator = (): SupervisionActor => ({ tenantId: tenant, userId: user, username: "合成删除验收", permissions: ["*"], tableDataScopes: [], requestId: "delete-fixture", source: "web" });

/** Dedicated network-isolated PG18 only. No .env or production DataSource imports.
 * Real RESTRICT FKs, Application transactions, HTTP routes and audit persistence.
 * Only AuthGuard is replaced by synthetic actors; production login is not exercised.
 */
integration("supervision safe deletion (isolated PostgreSQL + HTTP)", () => {
  let db: DataSource, app: INestApplication, service: SupervisionApplicationService, queries: SupervisionQueryService;
  let currentActor: SupervisionActor | null = administrator();
  const project = (values: Partial<SupervisionProject> = {}) => db.manager.save(SupervisionProject, db.manager.create(SupervisionProject, {
    id: uuidv7(), tenantId: tenant, projectCode: `SP-${uuidv7()}`, projectName: "合成项目", projectDescription: "合成说明", sourceType: "OTHER",
    ownerId: user, supervisorId: null, participantIds: [user], plannedStartDate: "2026-10-01", dueDate: "2026-11-15", acceptanceCriteria: "合成验收",
    lifecycleStatus: "NOT_STARTED", attachments: [], createdBy: user, updatedBy: user, version: 1, ...values
  }));
  const task = (parent: SupervisionProject, values: Partial<SupervisionTask> = {}) => db.manager.save(SupervisionTask, db.manager.create(SupervisionTask, {
    id: uuidv7(), tenantId: parent.tenantId, projectId: parent.id, taskCode: `ST-${uuidv7()}`, taskName: "合成任务", description: "合成说明", ownerId: user,
    collaboratorIds: [user], plannedStartDate: "2026-10-01", dueDate: "2026-11-15", acceptanceCriteria: "合成验收", lifecycleStatus: "NOT_STARTED",
    progress: "0", attachments: [], createdBy: user, updatedBy: user, version: 1, ...values
  }));
  const progress = (row: SupervisionTask) => db.manager.save(SupervisionTaskProgress, db.manager.create(SupervisionTaskProgress, {
    id: uuidv7(), tenantId: row.tenantId, projectId: row.projectId, taskId: row.id, updateType: "PROGRESS", summary: "必须保留的进展", attachments: [], createdBy: user, updatedBy: user
  }));
  const remove = (kind: "projects" | "tasks", id: string, version: unknown = 1) => request(app.getHttpServer()).delete(`/api/v1/supervision/${kind}/${id}${version == null ? "" : `?expectedVersion=${version}`}`);
  const employee = (resource: string, scope = "ALL"): SupervisionActor => ({ ...administrator(), permissions: [`${resource}:*:delete`], tableDataScopes: [{ resource, scope, actions: ["delete"] }] });
  beforeAll(async () => {
    if (!socket?.endsWith("/test/supervision_delete/pg_socket")) throw new Error("Only the dedicated isolated socket is permitted");
    db = new DataSource({ type: "postgres", host: socket, username: "postgres", database: "supervision_delete_test", entities: [SupervisionProject, SupervisionTask, SupervisionTaskProgress, AuditLog], poolSize: 4, extra: { options: "-c search_path=supervision_delete_fixture,public" } });
    await db.initialize();
    await db.query("DROP SCHEMA IF EXISTS supervision_delete_fixture CASCADE; CREATE SCHEMA supervision_delete_fixture");
    await db.query(`CREATE TABLE users(id uuid PRIMARY KEY,username text DEFAULT 'synthetic',display_name text DEFAULT '合成用户'); CREATE TABLE organization_units(id uuid PRIMARY KEY,name text);
      INSERT INTO users(id) VALUES('${user}'),('${other}');
      CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT uuidv7(),actor_id uuid,actor_name varchar,resource varchar NOT NULL,record_id varchar,action varchar NOT NULL,
      before_json jsonb,after_json jsonb,request_id varchar NOT NULL,source varchar NOT NULL,created_at timestamptz DEFAULT now(),created_by uuid,updated_at timestamptz DEFAULT now(),updated_by varchar DEFAULT 'system',version integer DEFAULT 1);`);
    const runner = { query: (sql: string, params?: unknown[]) => db.query(sql, params) } as QueryRunner;
    await new ProjectTaskSupervision1722920071000().up(runner);
    await new SupervisionFormUsability1722920073000().up(runner);
    await db.query("ALTER TABLE supervision_projects ADD COLUMN project_description text,ADD COLUMN actual_delivery_date date; ALTER TABLE supervision_tasks ADD COLUMN actual_delivery_date date");
    service = new SupervisionApplicationService(db);
    queries = new SupervisionQueryService(db, { listEnabled: async () => [] } as never);
    const module = await Test.createTestingModule({ controllers: [SupervisionController], providers: [
      { provide: SupervisionApplicationService, useValue: service }, { provide: SupervisionQueryService, useValue: queries }, { provide: OBJECT_STORAGE, useValue: {} }
    ] }).overrideGuard(AuthGuard).useValue({ canActivate: (context: any) => {
      if (!currentActor) throw new UnauthorizedException();
      const req = context.switchToHttp().getRequest(); req.user = { ...currentActor, sub: currentActor.userId }; req.requestId = currentActor.requestId; return true;
    } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix("api/v1"); await app.init();
  }, 30000);
  beforeEach(async () => { currentActor = administrator(); await db.query("TRUNCATE supervision_task_progress,supervision_tasks,supervision_projects,audit_logs CASCADE"); });
  afterAll(async () => { await app?.close(); if (db?.isInitialized) await db.destroy(); });

  it.each(["projects", "tasks"] as const)("%s: read/update cannot substitute for delete; anonymous remains 401", async kind => {
    const p = await project(), row = kind === "projects" ? p : await task(p);
    currentActor = { ...administrator(), permissions: [`supervision-${kind}:*:read`, `supervision-${kind}:*:update`] };
    await remove(kind, row.id).expect(403); currentActor = null; await remove(kind, row.id).expect(401);
    expect(await db.manager.count(kind === "projects" ? SupervisionProject : SupervisionTask)).toBe(1); expect(await db.manager.count(AuditLog)).toBe(0);
  });
  it("project and task deletion actions are independent", async () => {
    const p = await project(), t = await task(p);
    currentActor = employee("supervision-projects"); await remove("tasks", t.id).expect(403);
    currentActor = employee("supervision-tasks"); await remove("projects", p.id).expect(403); await remove("tasks", t.id).expect(200);
    currentActor = employee("supervision-projects"); await remove("projects", p.id).expect(200);
  });
  it.each(["projects", "tasks"] as const)("%s: checks exact version, and removes only the authorized row with a before audit", async kind => {
    const p = await project(), row = kind === "projects" ? p : await task(p);
    currentActor = employee(`supervision-${kind}`);
    await remove(kind, row.id, null).expect(400); await remove(kind, row.id, "abc").expect(400); await remove(kind, row.id, 2).expect(409);
    await remove(kind, row.id).expect(200); await remove(kind, row.id).expect(404);
    const [audit] = await db.manager.find(AuditLog); expect(audit).toMatchObject({ tenantId: tenant, actorId: user, recordId: row.id, resource: `supervision-${kind}`, requestId: "delete-fixture", beforeJson: { id: row.id, version: 1 }, afterJson: null });
  });
  it.each(["projects", "tasks"] as const)("%s: tenant boundary is enforced even for administrators", async kind => {
    const p = await project({ tenantId: `${tenant}-OTHER` }), row = kind === "projects" ? p : await task(p);
    await remove(kind, row.id).expect(404); expect(await db.manager.count(kind === "projects" ? SupervisionProject : SupervisionTask)).toBe(1);
  });
  it.each(["projects", "tasks"] as const)("%s: OWN is created_by and read scope cannot grant delete scope", async kind => {
    const p = await project({ createdBy: other }), row = kind === "projects" ? p : await task(p, { createdBy: other });
    currentActor = employee(`supervision-${kind}`, "OWN"); await remove(kind, row.id).expect(404);
    currentActor.tableDataScopes = [{ resource: `supervision-${kind}`, scope: "ALL", actions: ["read"] }]; await remove(kind, row.id).expect(404);
    currentActor.tableDataScopes = [{ resource: `supervision-${kind}`, scope: "CUSTOM", actions: ["delete"], rules: [{ fieldKey: "ownerId", operator: "EQ", value: "CURRENT_USER" }] }];
    await remove(kind, row.id).expect(200);
  });
  it("an unrelated Planning administrator never bypasses task delete scope", async () => {
    const t = await task(await project(), { createdBy: other }); currentActor = { ...employee("supervision-tasks", "OWN"), moduleAdminCodes: ["planning"] };
    await remove("tasks", t.id).expect(404);
  });
  it.each([{ isSystemAdmin: true }, { moduleAdminCodes: ["project-task"] }])("honors the existing administrator grant %j", async grant => {
    const p = await project(); currentActor = { ...administrator(), permissions: [], ...grant }; await remove("projects", p.id).expect(200);
  });
  it("refuses a project with any task, including an aborted task; no cascading deletion", async () => {
    const p = await project(), t = await task(p, { lifecycleStatus: "ABORTED", stopReason: "合成中止" });
    const r = await remove("projects", p.id).expect(409); expect(r.body.message).toContain("下属任务");
    expect(await db.manager.count(SupervisionProject)).toBe(1); expect(await db.manager.findOneBy(SupervisionTask, { id: t.id })).not.toBeNull(); expect(await db.manager.count(AuditLog)).toBe(0);
  });
  it("retains task and immutable progress history and the FK itself uses RESTRICT", async () => {
    const t = await task(await project()); await progress(t);
    const r = await remove("tasks", t.id).expect(409); expect(r.body.message).toContain("进展历史");
    expect(await db.manager.count(SupervisionTaskProgress)).toBe(1); expect(await db.manager.count(SupervisionTask)).toBe(1);
    await expect(db.manager.delete(SupervisionTask, { id: t.id })).rejects.toMatchObject({ driverError: { code: "23001" } });
  });
  it.each(["projects", "tasks"] as const)("%s: attachments are retained and never deleted from object storage", async kind => {
    const attachments = [{ key: `supervision/${tenant}/fixture/file.pdf`, name: "合成附件", contentType: "application/pdf", size: 1 }];
    const p = await project(kind === "projects" ? { attachments } : {}), row = kind === "projects" ? p : await task(p, { attachments });
    const r = await remove(kind, row.id).expect(409); expect(r.body.message).toContain("附件"); expect(await db.manager.count(AuditLog)).toBe(0);
  });
  it.each(["COMPLETED", "ABORTED"] as const)("terminal %s is retained rather than treated as deletion", async lifecycleStatus => {
    const p = await project({ lifecycleStatus, ...(lifecycleStatus === "COMPLETED" ? { completedAt: new Date(), completionSummary: "合成完成" } : { stopReason: "合成中止" }) });
    expect((await remove("projects", p.id).expect(409)).body.message).toContain("业务留痕");
  });
  it("an audit failure rolls the delete back; FK failures are clear business conflicts", async () => {
    const p = await project(); const original = (service as any).audit;
    (service as any).audit = async () => { throw new Error("synthetic audit rejection"); };
    try { await expect(service.deleteProject(p.id, 1, administrator())).rejects.toThrow("synthetic audit rejection"); }
    finally { (service as any).audit = original; }
    expect(await db.manager.findOneBy(SupervisionProject, { id: p.id })).not.toBeNull(); expect(await db.manager.count(AuditLog)).toBe(0);
    for (const code of ["23503", "23001"]) await expect((service as any).deleteTransaction(administrator(), async () => { throw { driverError: { code } }; })).rejects.toThrow("关联数据");
  });
  it("parallel requests never delete or audit a record twice", async () => {
    const t = await task(await project()); const result = await Promise.all([remove("tasks", t.id), remove("tasks", t.id)]);
    expect(result.map(r => r.status).sort()).toEqual([200, 404]); expect(await db.manager.count(AuditLog, { where: { recordId: t.id } })).toBe(1);
  });
  it("project progress and owner totals immediately reflect deletion without rewriting remaining tasks", async () => {
    const p = await project(), low = await task(p, { progress: "20" }), high = await task(p, { progress: "80" });
    expect((await queries.projectDashboard({}, administrator())).gantt[0].progress).toBe(50);
    expect((await queries.ownerReport({ startDate: "2026-10-01", endDate: "2026-11-30" }, administrator())).kpi.totalTasks).toBe(2);
    await remove("tasks", low.id).expect(200);
    expect((await queries.projectDashboard({}, administrator())).gantt[0].progress).toBe(80);
    expect((await queries.ownerReport({ startDate: "2026-10-01", endDate: "2026-11-30" }, administrator())).kpi.totalTasks).toBe(1);
    expect(await db.manager.findOneBy(SupervisionTask, { id: high.id })).toMatchObject({ progress: "80.00", version: 1 });
  });
});
