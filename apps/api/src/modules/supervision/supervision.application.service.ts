import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { In, type EntityManager, DataSource } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import {
  AuditLog, OrganizationUnit, SupervisionProject, SupervisionTask, SupervisionTaskProgress, User,
  type SupervisionAttachment
} from "../../entities";
import { hasSupervisionFieldPermission, hasSupervisionPermission, supervisionScopeClause, type SupervisionResource } from "./supervision.scope";
import type { ProgressInput, ProjectInput, SupervisionActor, TaskInput } from "./supervision.types";
import { shanghaiDate } from "./supervision.domain";

const sources = new Set(["IMPORTANT_MEETING", "STRATEGIC_TASK", "LEADER_ASSIGNMENT", "SPECIAL_WORK", "OTHER"]);
const priorities = new Set(["URGENT", "HIGH", "MEDIUM", "LOW"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const projectFields = ["projectName", "sourceType", "sourceName", "sourceDate", "ownerId", "supervisorId", "departmentId", "participantIds", "priority", "plannedStartDate", "dueDate", "acceptanceCriteria", "attachments"];
const taskFields = ["projectId", "taskName", "description", "ownerId", "collaboratorIds", "departmentId", "priority", "plannedStartDate", "acceptanceCriteria", "nextFollowupDate", "attachments"];

@Injectable()
export class SupervisionApplicationService {
  constructor(private readonly dataSource: DataSource) {}

  createProject(input: ProjectInput, actor: SupervisionActor) {
    this.assertAction(actor, "supervision-projects", "create");
    return this.transaction(actor, async (manager) => {
      const normalized = await this.projectInput(manager, input);
      this.assertAttachmentTenant(normalized.attachments, actor);
      this.assertCreateScope(actor, "supervision-projects", normalized as Record<string, unknown>);
      const id = uuidv7();
      const project = manager.create(SupervisionProject, {
        id, tenantId: actor.tenantId, projectCode: this.code("SP", id), lifecycleStatus: "NOT_STARTED", completedAt: null,
        completionSummary: null, stopReason: null, createdBy: actor.userId, updatedBy: actor.userId ?? actor.username, version: 1,
        ...normalized
      });
      await manager.save(SupervisionProject, project);
      await this.audit(manager, actor, "supervision-projects", id, "supervision.project.created", null, this.projectAudit(project));
      return project;
    });
  }

  updateProject(id: string, input: Partial<ProjectInput>, actor: SupervisionActor) {
    this.assertAction(actor, "supervision-projects", "update");
    return this.transaction(actor, async (manager) => {
      const project = await this.lockProject(manager, id, actor, "update");
      this.assertVersion(project.version, input.expectedVersion);
      if (["COMPLETED", "ABORTED"].includes(project.lifecycleStatus)) throw new BadRequestException("已完成或已中止的项目不能普通编辑");
      const changed = projectFields.filter((field) => Object.prototype.hasOwnProperty.call(input, field) && !this.sameFieldValue(field, input[field as keyof ProjectInput], project[field as keyof SupervisionProject]));
      this.assertFields(actor, "supervision-projects", changed);
      const normalized = await this.projectInput(manager, { ...project, ...input } as ProjectInput);
      this.assertAttachmentTenant(normalized.attachments, actor);
      const before = this.projectAudit(project);
      Object.assign(project, normalized, { version: project.version + 1, updatedBy: actor.userId ?? actor.username });
      await manager.save(SupervisionProject, project);
      await this.audit(manager, actor, "supervision-projects", id, "supervision.project.updated", before, this.projectAudit(project));
      return project;
    });
  }

  completeProject(id: string, input: { expectedVersion?: number; completionSummary?: string }, actor: SupervisionActor) {
    this.assertAction(actor, "supervision-projects", "update");
    return this.transaction(actor, async (manager) => {
      const project = await this.lockProject(manager, id, actor, "update");
      this.assertVersion(project.version, input.expectedVersion);
      if (project.lifecycleStatus === "ABORTED") throw new BadRequestException("已中止项目不能完成");
      if (project.lifecycleStatus === "COMPLETED") throw new BadRequestException("项目已经完成");
      const summary = this.requiredText(input.completionSummary, "完成说明", 5000);
      const tasks = await manager.findBy(SupervisionTask, { tenantId: actor.tenantId, projectId: id });
      const active = tasks.filter((task) => task.lifecycleStatus !== "ABORTED");
      if (!active.length) throw new BadRequestException("项目至少需要一个未中止任务后才能完成");
      if (active.some((task) => task.lifecycleStatus !== "COMPLETED")) throw new BadRequestException("仍有未完成任务，不能完成项目");
      const before = this.projectAudit(project);
      project.lifecycleStatus = "COMPLETED"; project.completedAt = new Date(); project.completionSummary = summary;
      project.version += 1; project.updatedBy = actor.userId ?? actor.username;
      await manager.save(SupervisionProject, project);
      await this.audit(manager, actor, "supervision-projects", id, "supervision.project.completed", before, this.projectAudit(project));
      return project;
    });
  }

  abortProject(id: string, input: { expectedVersion?: number; stopReason?: string }, actor: SupervisionActor) {
    this.assertAction(actor, "supervision-projects", "update");
    return this.transaction(actor, async (manager) => {
      const project = await this.lockProject(manager, id, actor, "update");
      this.assertVersion(project.version, input.expectedVersion);
      if (project.lifecycleStatus === "COMPLETED") throw new BadRequestException("已完成项目不能中止");
      if (project.lifecycleStatus === "ABORTED") throw new BadRequestException("项目已经中止");
      const openTasks = await manager.count(SupervisionTask, { where: { tenantId: actor.tenantId, projectId: id } });
      const terminalTasks = await manager.createQueryBuilder(SupervisionTask, "task").where("task.tenantId=:tenantId AND task.projectId=:projectId", { tenantId: actor.tenantId, projectId: id })
        .andWhere("task.lifecycleStatus IN (:...statuses)", { statuses: ["COMPLETED", "ABORTED"] }).getCount();
      if (openTasks !== terminalTasks) throw new BadRequestException("项目仍有进行中的任务，请先完成或中止相关任务");
      const before = this.projectAudit(project);
      project.lifecycleStatus = "ABORTED"; project.stopReason = this.requiredText(input.stopReason, "中止原因", 5000); project.completedAt = null;
      project.version += 1; project.updatedBy = actor.userId ?? actor.username;
      await manager.save(SupervisionProject, project);
      await this.audit(manager, actor, "supervision-projects", id, "supervision.project.aborted", before, this.projectAudit(project));
      return project;
    });
  }

  createTask(input: TaskInput, actor: SupervisionActor) {
    this.assertAction(actor, "supervision-tasks", "create");
    return this.transaction(actor, async (manager) => {
      const project = await this.lockProject(manager, String(input.projectId ?? ""), actor, "read");
      if (["COMPLETED", "ABORTED"].includes(project.lifecycleStatus)) throw new BadRequestException("已结束项目不能新增任务");
      const normalized = await this.taskInput(manager, input, null);
      this.assertAttachmentTenant(normalized.attachments, actor);
      this.assertCreateScope(actor, "supervision-tasks", { ...normalized, projectName: project.projectName });
      const id = uuidv7();
      const task = manager.create(SupervisionTask, {
        id, tenantId: actor.tenantId, taskCode: this.code("ST", id), lifecycleStatus: "NOT_STARTED", completedAt: null, stopReason: null,
        createdBy: actor.userId, updatedBy: actor.userId ?? actor.username, version: 1, ...normalized
      });
      await manager.save(SupervisionTask, task);
      await this.audit(manager, actor, "supervision-tasks", id, "supervision.task.created", null, this.taskAudit(task));
      return task;
    });
  }

  updateTask(id: string, input: Partial<TaskInput>, actor: SupervisionActor) {
    this.assertAction(actor, "supervision-tasks", "update");
    if (Object.prototype.hasOwnProperty.call(input, "dueDate")) throw new BadRequestException("任务截止日期必须通过“修改截止日期”操作调整");
    if (Object.prototype.hasOwnProperty.call(input, "progress")) throw new BadRequestException("任务进度必须通过“更新进展”操作调整");
    return this.transaction(actor, async (manager) => {
      const task = await this.lockTask(manager, id, actor, "update");
      this.assertVersion(task.version, input.expectedVersion);
      if (["COMPLETED", "ABORTED"].includes(task.lifecycleStatus)) throw new BadRequestException("已完成或已中止的任务不能普通编辑");
      const changed = taskFields.filter((field) => Object.prototype.hasOwnProperty.call(input, field) && !this.sameFieldValue(field, input[field as keyof TaskInput], task[field as keyof SupervisionTask]));
      this.assertFields(actor, "supervision-tasks", changed);
      if (input.projectId && input.projectId !== task.projectId) throw new BadRequestException("任务创建后不能更改所属项目");
      const normalized = await this.taskInput(manager, { ...task, ...input, dueDate: task.dueDate } as TaskInput, task);
      this.assertAttachmentTenant(normalized.attachments, actor);
      const before = this.taskAudit(task);
      Object.assign(task, normalized, { projectId: task.projectId, version: task.version + 1, updatedBy: actor.userId ?? actor.username });
      await manager.save(SupervisionTask, task);
      await this.audit(manager, actor, "supervision-tasks", id, "supervision.task.updated", before, this.taskAudit(task));
      return task;
    });
  }

  addProgress(input: ProgressInput, actor: SupervisionActor) {
    this.assertAction(actor, "supervision-task-progress", "create");
    this.assertAction(actor, "supervision-tasks", "update");
    this.assertFields(actor, "supervision-tasks", ["progress", ...(input.nextFollowupDate !== undefined ? ["nextFollowupDate"] : [])]);
    return this.transaction(actor, async (manager) => {
      const task = await this.lockTask(manager, String(input.taskId ?? ""), actor, "update");
      this.assertVersion(task.version, input.expectedTaskVersion);
      if (["COMPLETED", "ABORTED"].includes(task.lifecycleStatus)) throw new BadRequestException("已完成或已中止任务不能更新进展");
      const updateType = input.updateType ?? "PROGRESS";
      if (!["PROGRESS", "RISK"].includes(updateType)) throw new BadRequestException("延期变更和完成说明必须使用对应受控操作");
      const progress = input.progress == null ? null : this.progress(input.progress);
      const before = this.taskAudit(task);
      if (progress != null) task.progress = progress.toFixed(2);
      if (input.nextFollowupDate !== undefined) task.nextFollowupDate = this.optionalDate(input.nextFollowupDate, "下次跟进日期");
      task.lifecycleStatus = "IN_PROGRESS"; task.version += 1; task.updatedBy = actor.userId ?? actor.username;
      const record = this.progressRecord(actor, task, {
        updateType, progress: progress == null ? null : progress.toFixed(2), summary: this.requiredText(input.summary, "本次进展说明", 10000),
        riskIssue: this.optionalText(input.riskIssue, 10000), nextAction: this.optionalText(input.nextAction, 10000),
        nextFollowupDate: task.nextFollowupDate, proposedDueDate: null, changeReason: null, attachments: this.attachments(input.attachments)
      });
      this.assertAttachmentTenant(record.attachments, actor);
      await manager.save(SupervisionTask, task); await manager.save(SupervisionTaskProgress, record);
      await this.startProject(manager, task.projectId, actor);
      await this.audit(manager, actor, "supervision-task-progress", record.id, "supervision.task.progress_added", null, this.progressAudit(record));
      await this.audit(manager, actor, "supervision-tasks", task.id, "supervision.task.progress_applied", before, this.taskAudit(task));
      return { task, progressRecord: record };
    });
  }

  changeTaskDueDate(id: string, input: { expectedVersion?: number; dueDate?: string; changeReason?: string }, actor: SupervisionActor) {
    this.assertAction(actor, "supervision-tasks", "update");
    this.assertFields(actor, "supervision-tasks", ["dueDate"]);
    return this.transaction(actor, async (manager) => {
      const task = await this.lockTask(manager, id, actor, "update");
      this.assertVersion(task.version, input.expectedVersion);
      if (["COMPLETED", "ABORTED"].includes(task.lifecycleStatus)) throw new BadRequestException("已结束任务不能修改截止日期");
      const dueDate = this.requiredDate(input.dueDate, "调整后截止日期");
      if (task.plannedStartDate && dueDate < task.plannedStartDate) throw new BadRequestException("任务截止日期不能早于计划开始日期");
      const reason = this.requiredText(input.changeReason, "变更原因", 5000);
      const before = this.taskAudit(task); const priorDueDate = task.dueDate;
      task.dueDate = dueDate; task.version += 1; task.updatedBy = actor.userId ?? actor.username;
      const record = this.progressRecord(actor, task, { updateType: "DUE_DATE_CHANGE", progress: task.progress, summary: `截止日期由 ${priorDueDate} 调整为 ${dueDate}`,
        riskIssue: null, nextAction: null, nextFollowupDate: task.nextFollowupDate, proposedDueDate: dueDate, changeReason: reason, attachments: [] });
      await manager.save(SupervisionTask, task); await manager.save(SupervisionTaskProgress, record);
      await this.audit(manager, actor, "supervision-tasks", task.id, "supervision.task.due_date_changed", before, { ...this.taskAudit(task), changeReason: reason });
      await this.audit(manager, actor, "supervision-task-progress", record.id, "supervision.task.due_date_change_recorded", null, this.progressAudit(record));
      return { task, progressRecord: record };
    });
  }

  completeTask(id: string, input: { expectedVersion?: number; completionSummary?: string; attachments?: SupervisionAttachment[] }, actor: SupervisionActor) {
    this.assertAction(actor, "supervision-tasks", "update");
    return this.transaction(actor, async (manager) => {
      const task = await this.lockTask(manager, id, actor, "update");
      this.assertVersion(task.version, input.expectedVersion);
      if (task.lifecycleStatus === "ABORTED") throw new BadRequestException("已中止任务不能完成");
      if (task.lifecycleStatus === "COMPLETED") throw new BadRequestException("任务已经完成");
      const summary = this.requiredText(input.completionSummary, "完成说明", 10000); const before = this.taskAudit(task);
      task.lifecycleStatus = "COMPLETED"; task.progress = "100.00"; task.completedAt = new Date(); task.version += 1; task.updatedBy = actor.userId ?? actor.username;
      const record = this.progressRecord(actor, task, { updateType: "COMPLETION", progress: "100.00", summary, riskIssue: null, nextAction: null,
        nextFollowupDate: task.nextFollowupDate, proposedDueDate: null, changeReason: null, attachments: this.attachments(input.attachments) });
      this.assertAttachmentTenant(record.attachments, actor);
      await manager.save(SupervisionTask, task); await manager.save(SupervisionTaskProgress, record);
      await this.audit(manager, actor, "supervision-tasks", id, "supervision.task.completed", before, this.taskAudit(task));
      await this.audit(manager, actor, "supervision-task-progress", record.id, "supervision.task.completion_recorded", null, this.progressAudit(record));
      return { task, progressRecord: record };
    });
  }

  abortTask(id: string, input: { expectedVersion?: number; stopReason?: string }, actor: SupervisionActor) {
    this.assertAction(actor, "supervision-tasks", "update");
    return this.transaction(actor, async (manager) => {
      const task = await this.lockTask(manager, id, actor, "update");
      this.assertVersion(task.version, input.expectedVersion);
      if (task.lifecycleStatus === "COMPLETED") throw new BadRequestException("已完成任务不能中止");
      if (task.lifecycleStatus === "ABORTED") throw new BadRequestException("任务已经中止");
      const before = this.taskAudit(task);
      task.lifecycleStatus = "ABORTED"; task.stopReason = this.requiredText(input.stopReason, "中止原因", 5000); task.completedAt = null;
      task.version += 1; task.updatedBy = actor.userId ?? actor.username;
      await manager.save(SupervisionTask, task);
      await this.audit(manager, actor, "supervision-tasks", id, "supervision.task.aborted", before, this.taskAudit(task));
      return task;
    });
  }

  async recordAttachmentUpload(attachment: SupervisionAttachment, actor: SupervisionActor) {
    return this.transaction(actor, (manager) => this.audit(manager, actor, "supervision-attachments", null, "supervision.attachment.uploaded", null, attachment));
  }

  private async transaction<T>(actor: SupervisionActor, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      return work(manager);
    });
  }

  private assertAction(actor: SupervisionActor, resource: string, action: string) {
    if (!hasSupervisionPermission(actor, resource, action)) throw new ForbiddenException("当前权限组不能执行此操作");
  }
  private assertFields(actor: SupervisionActor, resource: string, fields: string[]) {
    for (const field of fields) if (!hasSupervisionFieldPermission(actor, resource, field, "update")) throw new ForbiddenException(`字段 ${field} 没有编辑权限`);
  }
  private assertVersion(current: number, expected: unknown) {
    if (!Number.isInteger(Number(expected)) || Number(expected) < 1) throw new BadRequestException("缺少有效的数据版本，请刷新后重试");
    if (current !== Number(expected)) throw new ConflictException({ message: "数据已被其他人修改，请刷新后重试", currentVersion: current });
  }
  private assertCreateScope(actor: SupervisionActor, resource: string, row: Record<string, unknown>) {
    if (actor.isSystemAdmin || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("project-task")) return;
    const scopes = actor.tableDataScopes.filter((scope) => scope.resource === resource && (!scope.actions || scope.actions.includes("create")));
    if (scopes.some((scope) => ["ALL", "OWN", "NONE"].includes(scope.scope))) return;
    const compare = (rule: { fieldKey?: string; operator?: string; value?: unknown }) => {
      const actual = row[String(rule.fieldKey ?? "")]; const expected = rule.value === "CURRENT_USER" ? actor.userId : rule.value;
      if (rule.operator === "IS_EMPTY") return actual == null || String(actual).trim() === "";
      if (rule.operator === "IS_NOT_EMPTY") return actual != null && String(actual).trim() !== "";
      const values = Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")];
      if (rule.operator === "IN") return values.includes(String(actual ?? ""));
      if (rule.operator === "NOT_IN") return !values.includes(String(actual ?? ""));
      if (rule.operator === "EQ") return String(actual ?? "") === String(expected ?? "");
      if (rule.operator === "NE") return String(actual ?? "") !== String(expected ?? "");
      if (rule.operator === "CONTAINS") return String(actual ?? "").includes(String(expected ?? ""));
      return false;
    };
    const allowed = scopes.filter((scope) => scope.scope === "CUSTOM").some((scope) => {
      const rules = scope.rules ?? []; return rules.length > 0 && (scope.match === "ANY" ? rules.some(compare) : rules.every(compare));
    });
    if (!allowed) throw new ForbiddenException("新增数据不在当前权限组的数据范围内");
  }

  private async assertRecordScope(manager: EntityManager, table: string, resource: SupervisionResource, id: string, actor: SupervisionActor, action: string) {
    const params: unknown[] = [actor.tenantId]; const scope = supervisionScopeClause(actor, resource, action, "record", params); params.push(id);
    const rows = await manager.query(`SELECT 1 FROM ${table} record WHERE record.tenant_id=$1 AND record.id=$${params.length}::uuid AND (${scope})`, params);
    if (!rows.length) throw new NotFoundException("记录不存在或不在当前权限范围内");
  }
  private async lockProject(manager: EntityManager, id: string, actor: SupervisionActor, action: string) {
    this.assertAction(actor, "supervision-projects", action);
    await this.assertRecordScope(manager, "supervision_projects", "supervision-projects", id, actor, action);
    const project = await manager.createQueryBuilder(SupervisionProject, "project").setLock("pessimistic_write")
      .where("project.id=:id AND project.tenantId=:tenantId", { id, tenantId: actor.tenantId }).getOne();
    if (!project) throw new NotFoundException("督办项目不存在"); return project;
  }
  private async lockTask(manager: EntityManager, id: string, actor: SupervisionActor, action: string) {
    await this.assertRecordScope(manager, "supervision_tasks", "supervision-tasks", id, actor, action);
    const task = await manager.createQueryBuilder(SupervisionTask, "task").setLock("pessimistic_write")
      .where("task.id=:id AND task.tenantId=:tenantId", { id, tenantId: actor.tenantId }).getOne();
    if (!task) throw new NotFoundException("督办任务不存在"); return task;
  }

  private async projectInput(manager: EntityManager, input: ProjectInput) {
    const plannedStartDate = this.requiredDate(input.plannedStartDate, "计划开始日期"); const dueDate = this.requiredDate(input.dueDate, "项目交付日期");
    if (plannedStartDate > dueDate) throw new BadRequestException("项目交付日期不能早于计划开始日期");
    const sourceType = this.optionalText(input.sourceType, 40); if (sourceType && !sources.has(sourceType)) throw new BadRequestException("来源类型无效");
    const priority = String(input.priority ?? "MEDIUM"); if (!priorities.has(priority)) throw new BadRequestException("优先级无效");
    const ownerId = String(input.ownerId ?? ""); const supervisorId = String(input.supervisorId ?? ""); const participantIds = this.ids(input.participantIds);
    if (!ownerId || !supervisorId) throw new BadRequestException("项目负责人和督办人不能为空");
    await this.members(manager, [ownerId, supervisorId, ...participantIds]); const departmentId = await this.department(manager, input.departmentId);
    return {
      projectName: this.requiredText(input.projectName, "项目名称", 300), sourceType, sourceName: this.optionalText(input.sourceName, 300), sourceDate: this.optionalDate(input.sourceDate, "来源日期"),
      ownerId, supervisorId, departmentId, participantIds, priority, plannedStartDate, dueDate,
      acceptanceCriteria: this.requiredText(input.acceptanceCriteria, "完成/验收标准", 10000), attachments: this.attachments(input.attachments)
    };
  }
  private async taskInput(manager: EntityManager, input: TaskInput, existing: SupervisionTask | null) {
    const projectId = String(existing?.projectId ?? input.projectId ?? "");
    if (!projectId) throw new BadRequestException("所属督办项目不能为空");
    const ownerId = String(input.ownerId ?? ""); if (!ownerId) throw new BadRequestException("任务责任人不能为空");
    const collaboratorIds = this.ids(input.collaboratorIds); await this.members(manager, [ownerId, ...collaboratorIds]);
    const departmentId = await this.department(manager, input.departmentId); const priority = String(input.priority ?? "MEDIUM");
    if (!priorities.has(priority)) throw new BadRequestException("优先级无效");
    const dueDate = this.requiredDate(input.dueDate, "任务截止日期"); const plannedStartDate = this.optionalDate(input.plannedStartDate, "计划开始日期");
    if (plannedStartDate && plannedStartDate > dueDate) throw new BadRequestException("任务截止日期不能早于计划开始日期");
    return {
      projectId, taskName: this.requiredText(input.taskName, "任务名称", 300), description: this.optionalText(input.description, 10000), ownerId, collaboratorIds, departmentId, priority,
      plannedStartDate, dueDate, progress: this.progress(existing?.progress ?? 0).toFixed(2),
      acceptanceCriteria: this.requiredText(input.acceptanceCriteria, "任务完成标准", 10000), nextFollowupDate: this.optionalDate(input.nextFollowupDate, "下次跟进日期"), attachments: this.attachments(input.attachments)
    };
  }
  private async members(manager: EntityManager, ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))]; if (!unique.length || unique.length !== ids.filter(Boolean).length && ids.some((id) => !id)) throw new BadRequestException("负责人不能为空");
    const count = await manager.count(User, { where: { id: In(unique), enabled: true } }); if (count !== unique.length) throw new BadRequestException("成员中包含不存在或已停用的用户");
  }
  private async department(manager: EntityManager, raw: unknown) {
    if (raw == null || raw === "") return null; const id = String(raw);
    if (!await manager.findOneBy(OrganizationUnit, { id, enabled: true })) throw new BadRequestException("责任部门不存在或已停用"); return id;
  }
  private progressRecord(actor: SupervisionActor, task: SupervisionTask, value: Omit<SupervisionTaskProgress, keyof import("../../entities").AuditedEntity | "id" | "tenantId" | "taskId" | "projectId">) {
    return Object.assign(new SupervisionTaskProgress(), value, { id: uuidv7(), tenantId: actor.tenantId, taskId: task.id, projectId: task.projectId, createdBy: actor.userId, updatedBy: actor.userId ?? actor.username, version: 1 });
  }
  private async startProject(manager: EntityManager, id: string, actor: SupervisionActor) {
    const project = await manager.findOneBy(SupervisionProject, { id, tenantId: actor.tenantId });
    if (project?.lifecycleStatus !== "NOT_STARTED") return;
    const before = this.projectAudit(project); project.lifecycleStatus = "IN_PROGRESS"; project.version += 1; project.updatedBy = actor.userId ?? actor.username;
    await manager.save(SupervisionProject, project); await this.audit(manager, actor, "supervision-projects", id, "supervision.project.started", before, this.projectAudit(project));
  }
  private code(prefix: string, id: string) { return `${prefix}-${shanghaiDate().replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`; }
  private sameFieldValue(field: string, left: unknown, right: unknown) {
    if (field === "progress") return Number(left ?? 0) === Number(right ?? 0);
    if (Array.isArray(left) || Array.isArray(right)) return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
    return (left == null || left === "" ? null : String(left)) === (right == null || right === "" ? null : String(right));
  }
  private requiredText(value: unknown, label: string, max: number) { const text = String(value ?? "").trim(); if (!text) throw new BadRequestException(`${label}不能为空`); if (text.length > max) throw new BadRequestException(`${label}不能超过 ${max} 个字符`); return text; }
  private optionalText(value: unknown, max: number) { if (value == null || String(value).trim() === "") return null; const text = String(value).trim(); if (text.length > max) throw new BadRequestException(`文本不能超过 ${max} 个字符`); return text; }
  private requiredDate(value: unknown, label: string) { const date = String(value ?? ""); if (!datePattern.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new BadRequestException(`${label}格式应为 YYYY-MM-DD`); return date; }
  private optionalDate(value: unknown, label: string) { return value == null || value === "" ? null : this.requiredDate(value, label); }
  private progress(value: unknown) { const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 100) throw new BadRequestException("完成进度必须在 0 到 100 之间"); return Math.round(number * 100) / 100; }
  private ids(value: unknown) { if (value == null) return []; if (!Array.isArray(value)) throw new BadRequestException("多选成员格式无效"); return [...new Set(value.map(String).filter(Boolean))]; }
  private attachments(value: unknown): SupervisionAttachment[] {
    if (value == null) return []; if (!Array.isArray(value) || value.length > 20) throw new BadRequestException("附件列表格式无效或超过 20 个");
    return value.map((item) => {
      const raw = item as Partial<SupervisionAttachment>; const key = String(raw?.key ?? ""); const name = String(raw?.name ?? "").trim();
      const contentType = String(raw?.contentType ?? "application/octet-stream"); const size = Number(raw?.size);
      if (!/^supervision\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(key) || !name || !Number.isInteger(size) || size < 0 || size > 20 * 1024 * 1024) throw new BadRequestException("附件元数据无效");
      return { key, name: name.slice(0, 255), contentType: contentType.slice(0, 150), size };
    });
  }
  private assertAttachmentTenant(attachments: SupervisionAttachment[], actor: SupervisionActor) {
    const prefix = `supervision/${actor.tenantId.replace(/[^A-Za-z0-9_-]/g, "_")}/`;
    if (attachments.some((attachment) => !attachment.key.startsWith(prefix))) throw new ForbiddenException("附件不属于当前租户");
  }
  private attachmentAudit(attachments: SupervisionAttachment[]) { return attachments.map(({ name, contentType, size }) => ({ name, contentType, size })); }
  private projectAudit(value: SupervisionProject) { const { participantIds, attachments, ...safe } = value; return { ...safe, participantIds, attachments: this.attachmentAudit(attachments), tenantId: value.tenantId }; }
  private taskAudit(value: SupervisionTask) { const { collaboratorIds, attachments, ...safe } = value; return { ...safe, collaboratorIds, attachments: this.attachmentAudit(attachments), tenantId: value.tenantId }; }
  private progressAudit(value: SupervisionTaskProgress) { const { attachments, ...safe } = value; return { ...safe, attachments: this.attachmentAudit(attachments), tenantId: value.tenantId }; }
  private async audit(manager: EntityManager, actor: SupervisionActor, resource: string, recordId: string | null, action: string, beforeJson: unknown, afterJson: unknown) {
    await manager.save(AuditLog, { tenantId: actor.tenantId, actorId: actor.userId, actorName: actor.displayName ?? actor.username, resource, recordId, action, beforeJson, afterJson, requestId: actor.requestId, source: actor.source ?? "web", updatedBy: actor.userId ?? actor.username });
  }
}
