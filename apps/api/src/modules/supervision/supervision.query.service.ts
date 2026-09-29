import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { SqlFilterCompiler } from "../../common/filtering/sql-filter.compiler";
import { normalizeKdosPageSize } from "../../common/pagination";
import { hasSupervisionFieldPermission, hasSupervisionPermission, supervisionColumnExpressions, supervisionScopeClause } from "./supervision.scope";
import type { SupervisionActor, SupervisionPageInput } from "./supervision.types";
import { OrganizationDirectoryService } from "../organization-directory/organization-directory.service";
import { shanghaiDate } from "./supervision.domain";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const displayExpression = "CASE WHEN task.lifecycle_status='COMPLETED' THEN 'COMPLETED' WHEN task.lifecycle_status='ABORTED' THEN 'ABORTED' WHEN task.due_date < (now() AT TIME ZONE 'Asia/Shanghai')::date THEN 'OVERDUE' ELSE 'NORMAL' END";

@Injectable()
export class SupervisionQueryService {
  constructor(private readonly dataSource: DataSource, private readonly directory: OrganizationDirectoryService) {}

  options(actor: SupervisionActor) {
    const resources = ["supervision-projects", "supervision-tasks", "supervision-task-progress"];
    if (!resources.some((resource) => ["read", "create", "update"].some((action) => hasSupervisionPermission(actor, resource, action)))) throw new ForbiddenException("当前权限组没有任务督办访问权限");
    return this.read(actor, async (manager) => {
      const canUseMembers = hasSupervisionPermission(actor, "supervision-projects", "create") || hasSupervisionPermission(actor, "supervision-tasks", "create")
        || ["ownerId", "supervisorId", "participantIds", "collaboratorIds"].some((field) => hasSupervisionFieldPermission(actor, "supervision-projects", field, "read") || hasSupervisionFieldPermission(actor, "supervision-tasks", field, "read"));
      const canUseDepartments = hasSupervisionPermission(actor, "supervision-projects", "create") || hasSupervisionPermission(actor, "supervision-tasks", "create")
        || hasSupervisionFieldPermission(actor, "supervision-projects", "departmentId", "read") || hasSupervisionFieldPermission(actor, "supervision-tasks", "departmentId", "read");
      const [users, departments] = await Promise.all([
        canUseMembers ? manager.query(`SELECT id,COALESCE(NULLIF(display_name,''),username) label FROM users WHERE enabled=true ORDER BY label`) : [],
        canUseDepartments ? this.directory.listEnabled() : []
      ]);
      let projects: Array<Record<string, unknown>> = [];
      if (hasSupervisionPermission(actor, "supervision-projects", "read")) {
        const params: unknown[] = [actor.tenantId]; const scope = supervisionScopeClause(actor, "supervision-projects", "read", "project", params);
        projects = await manager.query(`SELECT id,project_code "projectCode",project_name "projectName",lifecycle_status "lifecycleStatus" FROM supervision_projects project WHERE project.tenant_id=$1 AND (${scope}) ORDER BY project_code DESC`, params);
      }
      return { users, departments, projects };
    });
  }

  projectDashboard(query: Record<string, unknown>, actor: SupervisionActor) {
    this.assertRead(actor, "supervision-project-dashboard"); this.assertRead(actor, "supervision-projects");
    return this.read(actor, async (manager) => {
      const params: unknown[] = [actor.tenantId]; const scope = supervisionScopeClause(actor, "supervision-projects", "read", "project", params);
      const clauses = [`project.tenant_id=$1`, `(${scope})`];
      this.projectFilters(query, actor, params, clauses);
      const where = clauses.join(" AND ");
      const [kpi] = await manager.query(`
        WITH scoped AS (
          SELECT project.*,
            CASE WHEN lifecycle_status='COMPLETED' THEN 'COMPLETED' WHEN lifecycle_status='ABORTED' THEN 'ABORTED' WHEN due_date < (now() AT TIME ZONE 'Asia/Shanghai')::date THEN 'OVERDUE' ELSE 'NORMAL' END display_status,
            COALESCE((SELECT avg(CASE WHEN task.lifecycle_status='COMPLETED' THEN 100 ELSE task.progress END) FROM supervision_tasks task WHERE task.tenant_id=project.tenant_id AND task.project_id=project.id AND task.lifecycle_status<>'ABORTED'),0) progress
          FROM supervision_projects project WHERE ${where}
        ) SELECT count(*)::integer total,
          count(*) FILTER(WHERE display_status='NORMAL')::integer normal,
          count(*) FILTER(WHERE display_status='OVERDUE')::integer overdue,
          count(*) FILTER(WHERE lifecycle_status NOT IN ('COMPLETED','ABORTED') AND due_date BETWEEN (now() AT TIME ZONE 'Asia/Shanghai')::date AND (now() AT TIME ZONE 'Asia/Shanghai')::date+7)::integer "dueWithin7Days",
          COALESCE(round(avg(progress),2),0)::float8 "averageProgress" FROM scoped`, params);
      const risks = await manager.query(`
        SELECT project.id,project.project_code "projectCode",project.project_name "projectName",project.due_date "dueDate",
          CASE WHEN project.due_date < (now() AT TIME ZONE 'Asia/Shanghai')::date THEN '已延期'
            WHEN project.due_date <= (now() AT TIME ZONE 'Asia/Shanghai')::date+7 THEN '即将到期' ELSE '进度明显落后' END "riskType",
          COALESCE((SELECT round(avg(CASE WHEN task.lifecycle_status='COMPLETED' THEN 100 ELSE task.progress END),2) FROM supervision_tasks task WHERE task.tenant_id=project.tenant_id AND task.project_id=project.id AND task.lifecycle_status<>'ABORTED'),0)::float8 progress
        FROM supervision_projects project WHERE ${where} AND project.lifecycle_status NOT IN ('COMPLETED','ABORTED') AND (
          project.due_date <= (now() AT TIME ZONE 'Asia/Shanghai')::date+7 OR
          (project.planned_start_date < (now() AT TIME ZONE 'Asia/Shanghai')::date AND project.due_date>project.planned_start_date AND
           COALESCE((SELECT avg(CASE WHEN task.lifecycle_status='COMPLETED' THEN 100 ELSE task.progress END) FROM supervision_tasks task WHERE task.tenant_id=project.tenant_id AND task.project_id=project.id AND task.lifecycle_status<>'ABORTED'),0)+20 <
           100*((now() AT TIME ZONE 'Asia/Shanghai')::date-project.planned_start_date)/GREATEST(project.due_date-project.planned_start_date,1))
        ) ORDER BY project.due_date ASC LIMIT 20`, params);
      const gantt = await manager.query(`SELECT project.id,project.project_code "projectCode",project.project_name "projectName",project.planned_start_date "plannedStartDate",project.due_date "dueDate",
        COALESCE((SELECT round(avg(CASE WHEN task.lifecycle_status='COMPLETED' THEN 100 ELSE task.progress END),2) FROM supervision_tasks task WHERE task.tenant_id=project.tenant_id AND task.project_id=project.id AND task.lifecycle_status<>'ABORTED'),0)::float8 progress,
        (SELECT count(*)::integer FROM supervision_tasks task WHERE task.tenant_id=project.tenant_id AND task.project_id=project.id) "taskCount"
        FROM supervision_projects project WHERE ${where} ORDER BY project.planned_start_date,project.project_code LIMIT 200`, params);
      const safeKpi = {
        total: kpi.total,
        ...(hasSupervisionFieldPermission(actor, "supervision-project-dashboard", "displayStatus", "read") ? { normal: kpi.normal, overdue: kpi.overdue } : {}),
        ...(hasSupervisionFieldPermission(actor, "supervision-project-dashboard", "dueDate", "read") ? { dueWithin7Days: kpi.dueWithin7Days } : {}),
        ...(hasSupervisionFieldPermission(actor, "supervision-project-dashboard", "progress", "read") ? { averageProgress: kpi.averageProgress } : {})
      };
      return { kpi: safeKpi, risks: this.cropDashboard(actor, risks), gantt: this.cropDashboard(actor, gantt) };
    });
  }

  employeeDashboard(query: SupervisionPageInput & Record<string, unknown>, actor: SupervisionActor) {
    this.assertRead(actor, "supervision-employee-dashboard"); this.assertRead(actor, "supervision-tasks");
    if (!actor.userId) throw new ForbiddenException("当前身份没有关联员工账号");
    return this.read(actor, async (manager) => {
      const params: unknown[] = [actor.tenantId]; const scope = supervisionScopeClause(actor, "supervision-tasks", "read", "task", params); params.push(actor.userId);
      const userIndex = params.length; const clauses = [`task.tenant_id=$1`, `(${scope})`, `(task.owner_id=$${userIndex}::uuid OR task.collaborator_ids ? $${userIndex}::uuid::text)`];
      this.taskFilters(query, actor, params, clauses, "task");
      this.taskSearch(query.search, actor, params, clauses, "task");
      const where = clauses.join(" AND ");
      const [kpi] = await manager.query(`SELECT
        count(*) FILTER(WHERE task.lifecycle_status NOT IN ('COMPLETED','ABORTED'))::integer "unfinished",
        count(*) FILTER(WHERE task.lifecycle_status NOT IN ('COMPLETED','ABORTED') AND task.due_date=(now() AT TIME ZONE 'Asia/Shanghai')::date)::integer "dueToday",
        count(*) FILTER(WHERE task.lifecycle_status NOT IN ('COMPLETED','ABORTED') AND task.due_date BETWEEN date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai')::date AND date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai')::date+6)::integer "dueThisWeek",
        count(*) FILTER(WHERE task.lifecycle_status NOT IN ('COMPLETED','ABORTED') AND task.due_date<(now() AT TIME ZONE 'Asia/Shanghai')::date)::integer overdue
        FROM supervision_tasks task LEFT JOIN supervision_projects project ON project.tenant_id=task.tenant_id AND project.id=task.project_id WHERE ${where}`, params);
      const week = await manager.query(`SELECT task.id,task.task_code "taskCode",task.task_name "taskName",task.due_date "dueDate",project.project_name "projectName",task.priority
        FROM supervision_tasks task JOIN supervision_projects project ON project.tenant_id=task.tenant_id AND project.id=task.project_id WHERE ${where}
        AND task.lifecycle_status NOT IN ('COMPLETED','ABORTED') AND task.due_date BETWEEN date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai')::date AND date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai')::date+6
        ORDER BY task.due_date,task.priority,task.task_code`, params);
      const page = this.page(query); const sort = this.taskSort(query.sortField, query.sortOrder);
      const [{ count }] = await manager.query(`SELECT count(*)::integer count FROM supervision_tasks task JOIN supervision_projects project ON project.tenant_id=task.tenant_id AND project.id=task.project_id WHERE ${where}`, params);
      const paged = [...params, page.pageSize, (page.page - 1) * page.pageSize];
      const rows = await manager.query(`SELECT task.id,task.version,task.task_code "taskCode",task.project_id "projectId",project.project_name "projectName",task.task_name "taskName",task.owner_id "ownerId",task.department_id "departmentId",task.priority,
        task.planned_start_date "plannedStartDate",task.due_date "dueDate",task.lifecycle_status "lifecycleStatus",${displayExpression} "displayStatus",task.progress::float8 progress,
        (SELECT p.summary FROM supervision_task_progress p WHERE p.tenant_id=task.tenant_id AND p.task_id=task.id ORDER BY p.created_at DESC,p.id DESC LIMIT 1) "latestProgress",task.completed_at "completedAt"
        FROM supervision_tasks task JOIN supervision_projects project ON project.tenant_id=task.tenant_id AND project.id=task.project_id WHERE ${where} ORDER BY ${sort} LIMIT $${paged.length - 1} OFFSET $${paged.length}`, paged);
      const safeKpi = {
        ...(hasSupervisionFieldPermission(actor, "supervision-employee-dashboard", "ownerId", "read") ? { unfinished: kpi.unfinished } : {}),
        ...(hasSupervisionFieldPermission(actor, "supervision-employee-dashboard", "dueDate", "read") ? { dueToday: kpi.dueToday, dueThisWeek: kpi.dueThisWeek } : {}),
        ...(hasSupervisionFieldPermission(actor, "supervision-employee-dashboard", "displayStatus", "read") ? { overdue: kpi.overdue } : {})
      };
      return { kpi: safeKpi, week: this.cropEmployeeWeek(actor, week), rows: this.cropTaskRows(actor, rows), total: Number(count), ...page };
    });
  }

  ownerReport(query: Record<string, unknown>, actor: SupervisionActor) {
    this.assertRead(actor, "supervision-owner-report"); this.assertRead(actor, "supervision-tasks");
    return this.read(actor, async (manager) => {
      const { startDate, endDate } = this.period(query.startDate, query.endDate); const params: unknown[] = [actor.tenantId];
      const scope = supervisionScopeClause(actor, "supervision-tasks", "read", "task", params); params.push(startDate, endDate);
      const clauses = [`task.tenant_id=$1`, `(${scope})`, `task.due_date BETWEEN $${params.length - 1}::date AND $${params.length}::date`];
      this.reportFilters(query, actor, params, clauses); const where = clauses.join(" AND ");
      const rows: Array<Record<string, unknown>> = await manager.query(`WITH scoped AS (
        SELECT task.*,project.project_name FROM supervision_tasks task JOIN supervision_projects project ON project.tenant_id=task.tenant_id AND project.id=task.project_id WHERE ${where}
      ) SELECT scoped.owner_id "ownerId",COALESCE(u.display_name,u.username) "ownerName",
        CASE WHEN count(DISTINCT scoped.department_id)=1 THEN (array_agg(DISTINCT scoped.department_id) FILTER(WHERE scoped.department_id IS NOT NULL))[1] END "departmentId",
        COALESCE(string_agg(DISTINCT org.name,'、' ORDER BY org.name),'—') "departmentName",
        count(*) FILTER(WHERE scoped.lifecycle_status<>'ABORTED')::integer "totalTasks",
        count(*) FILTER(WHERE scoped.lifecycle_status='COMPLETED' AND (scoped.completed_at AT TIME ZONE 'Asia/Shanghai')::date<=scoped.due_date)::integer "onTimeCompleted",
        count(*) FILTER(WHERE scoped.lifecycle_status='COMPLETED' AND (scoped.completed_at AT TIME ZONE 'Asia/Shanghai')::date>scoped.due_date)::integer "lateCompleted",
        count(*) FILTER(WHERE scoped.lifecycle_status NOT IN ('COMPLETED','ABORTED') AND scoped.due_date<(now() AT TIME ZONE 'Asia/Shanghai')::date)::integer "currentlyOverdue",
        count(*) FILTER(WHERE scoped.lifecycle_status NOT IN ('COMPLETED','ABORTED') AND scoped.due_date>=(now() AT TIME ZONE 'Asia/Shanghai')::date)::integer "notDueIncomplete",
        count(*) FILTER(WHERE scoped.lifecycle_status='ABORTED')::integer aborted,
        CASE WHEN count(*) FILTER(WHERE scoped.lifecycle_status<>'ABORTED')=0 THEN 0 ELSE round(100.0*count(*) FILTER(WHERE scoped.lifecycle_status='COMPLETED' AND (scoped.completed_at AT TIME ZONE 'Asia/Shanghai')::date<=scoped.due_date)/count(*) FILTER(WHERE scoped.lifecycle_status<>'ABORTED'),2) END::float8 "onTimeRate",
        COALESCE(round(avg(CASE WHEN scoped.lifecycle_status='COMPLETED' AND (scoped.completed_at AT TIME ZONE 'Asia/Shanghai')::date>scoped.due_date THEN (scoped.completed_at AT TIME ZONE 'Asia/Shanghai')::date-scoped.due_date WHEN scoped.lifecycle_status NOT IN ('COMPLETED','ABORTED') AND scoped.due_date<(now() AT TIME ZONE 'Asia/Shanghai')::date THEN (now() AT TIME ZONE 'Asia/Shanghai')::date-scoped.due_date END),2),0)::float8 "averageDelayDays"
        FROM scoped JOIN users u ON u.id=scoped.owner_id LEFT JOIN organization_units org ON org.id=scoped.department_id GROUP BY scoped.owner_id,u.display_name,u.username ORDER BY "onTimeRate" DESC,"totalTasks" DESC,"ownerName"`, params);
      const normalized: Array<Record<string, unknown> & { overdueTasks: number }> = this.sortReportRows(
        this.searchReportRows(rows.map((row) => ({ ...row, overdueTasks: Number(row.lateCompleted) + Number(row.currentlyOverdue) })) as Array<Record<string, unknown> & { overdueTasks: number }>, query.search, actor),
        query.sortField, query.sortOrder, actor
      );
      const kpi = normalized.reduce<{ owners: number; totalTasks: number; onTimeCompleted: number; overdueTasks: number }>((sum, row) => ({ owners: sum.owners + 1, totalTasks: sum.totalTasks + Number(row.totalTasks), onTimeCompleted: sum.onTimeCompleted + Number(row.onTimeCompleted), overdueTasks: sum.overdueTasks + Number(row.overdueTasks) }), { owners: 0, totalTasks: 0, onTimeCompleted: 0, overdueTasks: 0 });
      const page = this.page(query); const offset = (page.page - 1) * page.pageSize;
      const fullKpi = { ...kpi, onTimeRate: kpi.totalTasks ? Number((100 * kpi.onTimeCompleted / kpi.totalTasks).toFixed(2)) : 0 };
      const safeKpi = Object.fromEntries(Object.entries(fullKpi).filter(([key]) => key === "owners"
        ? hasSupervisionFieldPermission(actor, "supervision-owner-report", "ownerId", "read")
        : hasSupervisionFieldPermission(actor, "supervision-owner-report", key === "overdueTasks" ? "overdueTasks" : key, "read")));
      return { period: { startDate, endDate }, kpi: safeKpi, chartRows: this.cropReportRows(actor, normalized.slice(0, 20)), rows: this.cropReportRows(actor, normalized.slice(offset, offset + page.pageSize)), total: normalized.length, ...page };
    });
  }

  ownerReportTasks(ownerId: string, query: SupervisionPageInput & Record<string, unknown>, actor: SupervisionActor) {
    this.assertRead(actor, "supervision-owner-report"); this.assertRead(actor, "supervision-tasks");
    return this.read(actor, async (manager) => {
      const { startDate, endDate } = this.period(query.startDate, query.endDate); const params: unknown[] = [actor.tenantId];
      const scope = supervisionScopeClause(actor, "supervision-tasks", "read", "task", params); params.push(startDate, endDate, ownerId);
      const clauses = [`task.tenant_id=$1`, `(${scope})`, `task.due_date BETWEEN $${params.length - 2}::date AND $${params.length - 1}::date`, `task.owner_id=$${params.length}::uuid`];
      this.reportFilters(query, actor, params, clauses, true); this.taskSearch(query.search, actor, params, clauses, "task"); const where = clauses.join(" AND "); const page = this.page(query);
      const [{ count }] = await manager.query(`SELECT count(*)::integer count FROM supervision_tasks task JOIN supervision_projects project ON project.tenant_id=task.tenant_id AND project.id=task.project_id WHERE ${where}`, params);
      const paged = [...params, page.pageSize, (page.page - 1) * page.pageSize];
      const rows = await manager.query(`SELECT task.id,task.task_code "taskCode",project.project_name "projectName",task.task_name "taskName",task.owner_id "ownerId",task.department_id "departmentId",task.due_date "dueDate",task.lifecycle_status "lifecycleStatus",task.completed_at "completedAt",
        CASE WHEN task.lifecycle_status='ABORTED' THEN 'ABORTED' WHEN task.lifecycle_status='COMPLETED' AND (task.completed_at AT TIME ZONE 'Asia/Shanghai')::date<=task.due_date THEN 'ON_TIME' WHEN task.lifecycle_status='COMPLETED' THEN 'LATE_COMPLETED' WHEN task.due_date<(now() AT TIME ZONE 'Asia/Shanghai')::date THEN 'CURRENTLY_OVERDUE' ELSE 'NOT_DUE' END classification
        FROM supervision_tasks task JOIN supervision_projects project ON project.tenant_id=task.tenant_id AND project.id=task.project_id WHERE ${where} ORDER BY ${this.taskSort(query.sortField, query.sortOrder)} LIMIT $${paged.length - 1} OFFSET $${paged.length}`, paged);
      const canClassify = ["onTimeCompleted", "overdueTasks", "notDueIncomplete", "aborted"].every((field) => hasSupervisionFieldPermission(actor, "supervision-owner-report", field, "read"));
      const safeRows = this.cropTaskRows(actor, rows).map((row) => canClassify ? row : Object.fromEntries(Object.entries(row).filter(([key]) => key !== "classification")));
      return { rows: safeRows, total: Number(count), ...page, period: { startDate, endDate } };
    });
  }

  async attachment(resource: "projects" | "tasks" | "progress", id: string, index: number, actor: SupervisionActor) {
    const config = resource === "projects" ? { table: "supervision_projects", code: "supervision-projects" as const } : resource === "tasks" ? { table: "supervision_tasks", code: "supervision-tasks" as const } : { table: "supervision_task_progress", code: "supervision-task-progress" as const };
    this.assertRead(actor, config.code);
    return this.read(actor, async (manager) => {
      const params: unknown[] = [actor.tenantId]; const scope = supervisionScopeClause(actor, config.code, "read", "record", params); params.push(id);
      const [row] = await manager.query(`SELECT attachments FROM ${config.table} record WHERE record.tenant_id=$1 AND record.id=$${params.length}::uuid AND (${scope})`, params);
      const attachments = Array.isArray(row?.attachments) ? row.attachments : []; const attachment = attachments[index];
      if (!attachment) throw new BadRequestException("附件不存在"); return attachment as { key: string; name: string; contentType: string; size: number };
    });
  }

  private read<T>(actor: SupervisionActor, work: (manager: EntityManager) => Promise<T>) { return this.dataSource.transaction(async (manager) => { await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]); return work(manager); }); }
  private assertRead(actor: SupervisionActor, resource: string) { if (!hasSupervisionPermission(actor, resource, "read")) throw new ForbiddenException("当前权限组没有此页面的查看权限"); }
  private projectFilters(query: Record<string, unknown>, actor: SupervisionActor, params: unknown[], clauses: string[]) {
    const add = (key: string, clause: (index: number) => string, value: unknown) => { if (value == null || value === "") return; if (!hasSupervisionFieldPermission(actor, "supervision-project-dashboard", key, "read")) throw new ForbiddenException(`当前权限组不能按 ${key} 筛选`); params.push(value); clauses.push(clause(params.length)); };
    if (query.projectName != null && String(query.projectName).trim()) add("projectName", (i) => `project.project_name ILIKE $${i}`, `%${String(query.projectName).trim()}%`);
    add("ownerId", (i) => `project.owner_id=$${i}::uuid`, query.ownerId);
    add("departmentId", (i) => `project.department_id=$${i}::uuid`, query.departmentId); add("sourceType", (i) => `project.source_type=$${i}`, query.sourceType);
    add("dueDate", (i) => `project.due_date>=$${i}::date`, query.dueFrom); add("dueDate", (i) => `project.due_date<=$${i}::date`, query.dueTo);
    add("displayStatus", (i) => `(CASE WHEN project.lifecycle_status='COMPLETED' THEN 'COMPLETED' WHEN project.lifecycle_status='ABORTED' THEN 'ABORTED' WHEN project.due_date<(now() AT TIME ZONE 'Asia/Shanghai')::date THEN 'OVERDUE' ELSE 'NORMAL' END)=$${i}`, query.displayStatus);
  }
  private taskFilters(query: Record<string, unknown>, actor: SupervisionActor, params: unknown[], clauses: string[], alias: string) {
    const add = (field: string, value: unknown, clause: (index: number) => string) => { if (value == null || value === "") return; if (!hasSupervisionFieldPermission(actor, "supervision-employee-dashboard", field, "read")) throw new ForbiddenException(`当前权限组不能按 ${field} 筛选`); params.push(value); clauses.push(clause(params.length)); };
    add("projectId", query.projectId, (i) => `${alias}.project_id=$${i}::uuid`); add("dueDate", query.dueFrom, (i) => `${alias}.due_date>=$${i}::date`); add("dueDate", query.dueTo, (i) => `${alias}.due_date<=$${i}::date`);
    if (query.projectName != null && String(query.projectName).trim()) add("projectName", `%${String(query.projectName).trim()}%`, (i) => `project.project_name ILIKE $${i}`);
    add("projectStatus", query.projectStatus, (i) => `(CASE WHEN project.lifecycle_status='COMPLETED' THEN 'COMPLETED' WHEN project.lifecycle_status='ABORTED' THEN 'ABORTED' WHEN project.due_date<(now() AT TIME ZONE 'Asia/Shanghai')::date THEN 'OVERDUE' ELSE 'NORMAL' END)=$${i}`);
    add("displayStatus", query.displayStatus, (i) => `(${displayExpression})=$${i}`);
    if (query.filterGroup != null && String(query.filterGroup).trim() !== "") {
      const compiler = new SqlFilterCompiler(
        tablePermissionFieldsFor("supervision-tasks"), supervisionColumnExpressions("supervision-tasks", alias),
        (key) => hasSupervisionFieldPermission(actor, "supervision-tasks", key, "read"), (column) => column
      );
      clauses.push(compiler.compile(query.filterGroup, params));
    }
  }
  private taskSearch(raw: unknown, actor: SupervisionActor, params: unknown[], clauses: string[], alias: string) {
    const keyword = String(raw ?? "").trim();
    if (!keyword) return;
    const expressions: Array<[string, string]> = [
      ["taskCode", `${alias}.task_code`], ["projectName", "project.project_name"], ["taskName", `${alias}.task_name`],
      ["description", `${alias}.description`], ["latestProgress", `(SELECT progress.summary FROM supervision_task_progress progress WHERE progress.tenant_id=${alias}.tenant_id AND progress.task_id=${alias}.id ORDER BY progress.created_at DESC,progress.id DESC LIMIT 1)`]
    ];
    const readable = expressions.filter(([field]) => hasSupervisionFieldPermission(actor, "supervision-tasks", field, "read")).map(([, expression]) => expression);
    if (!readable.length) throw new ForbiddenException("当前权限组没有可搜索的任务字段");
    params.push(`%${keyword}%`); clauses.push(`(${readable.map((expression) => `COALESCE(${expression},'') ILIKE $${params.length}`).join(" OR ")})`);
  }
  private reportFilters(query: Record<string, unknown>, actor: SupervisionActor, params: unknown[], clauses: string[], ownerFixed = false) {
    const add = (field: string, value: unknown, clause: (index: number) => string) => { if (value == null || value === "") return; if (!hasSupervisionFieldPermission(actor, "supervision-owner-report", field, "read")) throw new ForbiddenException(`当前权限组不能按 ${field} 筛选`); params.push(value); clauses.push(clause(params.length)); };
    if (query.projectName != null && String(query.projectName).trim()) add("projectName", `%${String(query.projectName).trim()}%`, (i) => `project.project_name ILIKE $${i}`);
    add("departmentId", query.departmentId, (i) => `task.department_id=$${i}::uuid`); if (!ownerFixed) add("ownerId", query.ownerId, (i) => `task.owner_id=$${i}::uuid`);
    if (query.filterGroup != null && String(query.filterGroup).trim() !== "") {
      const compiler = new SqlFilterCompiler(tablePermissionFieldsFor("supervision-tasks"), supervisionColumnExpressions("supervision-tasks", "task"),
        (key) => hasSupervisionFieldPermission(actor, "supervision-tasks", key, "read"), (column) => column);
      clauses.push(compiler.compile(query.filterGroup, params));
    }
  }
  private period(startRaw: unknown, endRaw: unknown) { const today = shanghaiDate(); const monthStart = `${today.slice(0, 7)}-01`; const [year, month] = monthStart.split("-").map(Number); const monthEnd = new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10); const start = String(startRaw ?? monthStart); const end = String(endRaw ?? monthEnd); if (!datePattern.test(start) || !datePattern.test(end) || start > end) throw new BadRequestException("统计周期无效"); return { startDate: start, endDate: end }; }
  private page(query: SupervisionPageInput) { return { page: Math.max(Number(query.page) || 1, 1), pageSize: normalizeKdosPageSize(query.pageSize) }; }
  private taskSort(field: unknown, order: unknown) { const allowed: Record<string, string> = { taskCode: "task.task_code", projectName: "project.project_name", taskName: "task.task_name", priority: "task.priority", dueDate: "task.due_date", progress: "task.progress" }; const key = String(field ?? "dueDate"); return `${allowed[key] ?? allowed.dueDate} ${String(order).toLowerCase() === "desc" ? "DESC" : "ASC"},task.task_code ASC`; }
  private searchReportRows<T extends Record<string, unknown>>(rows: T[], raw: unknown, actor: SupervisionActor) {
    const keyword = String(raw ?? "").trim().toLocaleLowerCase(); if (!keyword) return rows;
    const keys = [hasSupervisionFieldPermission(actor, "supervision-owner-report", "ownerId", "read") ? "ownerName" : null,
      hasSupervisionFieldPermission(actor, "supervision-owner-report", "departmentId", "read") ? "departmentName" : null].filter((key): key is string => Boolean(key));
    if (!keys.length) throw new ForbiddenException("当前权限组没有可搜索的报表字段");
    return rows.filter((row) => keys.some((key) => String(row[key] ?? "").toLocaleLowerCase().includes(keyword)));
  }
  private sortReportRows<T extends Record<string, unknown>>(rows: T[], rawField: unknown, rawOrder: unknown, actor: SupervisionActor) {
    const field = String(rawField ?? ""); if (!field) return rows;
    const aliases: Record<string, string> = { ownerName: "ownerId", departmentName: "departmentId" };
    const permissionField = aliases[field] ?? field;
    if (!tablePermissionFieldsFor("supervision-owner-report").some((item) => item.key === permissionField) || !hasSupervisionFieldPermission(actor, "supervision-owner-report", permissionField, "read")) return rows;
    const direction = String(rawOrder).toLowerCase() === "desc" ? -1 : 1;
    return [...rows].sort((left, right) => direction * String(left[field] ?? "").localeCompare(String(right[field] ?? ""), "zh-CN", { numeric: true }));
  }
  private cropDashboard(actor: SupervisionActor, rows: Array<Record<string, unknown>>) { return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key === "id" || hasSupervisionFieldPermission(actor, "supervision-project-dashboard", key, "read")))); }
  private cropEmployeeWeek(actor: SupervisionActor, rows: Array<Record<string, unknown>>) { return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key === "id" || hasSupervisionFieldPermission(actor, "supervision-employee-dashboard", key, "read")))); }
  private cropReportRows(actor: SupervisionActor, rows: Array<Record<string, unknown>>) { const pairs: Record<string, string> = { ownerName: "ownerId", departmentName: "departmentId" }; return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => hasSupervisionFieldPermission(actor, "supervision-owner-report", pairs[key] ?? key, "read")))); }
  private cropTaskRows(actor: SupervisionActor, rows: Array<Record<string, unknown>>) { const definitions = new Set(tablePermissionFieldsFor("supervision-tasks").filter((field) => hasSupervisionFieldPermission(actor, "supervision-tasks", field.key, "read")).map((field) => field.key)); return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => ["id", "version", "classification"].includes(key) || definitions.has(key)))); }
}
