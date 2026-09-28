import { ForbiddenException, Injectable, type OnModuleInit } from "@nestjs/common";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { DataSource } from "typeorm";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";
import { hasSupervisionPermission, supervisionColumnExpressions, supervisionScopeClause, type SupervisionResource } from "./supervision.scope";
import type { SupervisionActor } from "./supervision.types";

const physicalColumns: Record<SupervisionResource, Record<string, string>> = {
  "supervision-projects": {
    id: "id", version: "version", projectCode: "project_code", projectName: "project_name", projectDescription: "project_description", sourceType: "source_type", sourceName: "source_name", sourceDate: "source_date",
    ownerId: "owner_id", supervisorId: "supervisor_id", departmentId: "department_id", participantIds: "participant_ids", priority: "priority",
    plannedStartDate: "planned_start_date", dueDate: "due_date", actualDeliveryDate: "actual_delivery_date", lifecycleStatus: "lifecycle_status", acceptanceCriteria: "acceptance_criteria",
    completionSummary: "completion_summary", stopReason: "stop_reason", attachments: "attachments", completedAt: "completed_at",
    createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
  },
  "supervision-tasks": {
    id: "id", version: "version", taskCode: "task_code", projectId: "project_id", taskName: "task_name", description: "description", ownerId: "owner_id",
    collaboratorIds: "collaborator_ids", departmentId: "department_id", priority: "priority", plannedStartDate: "planned_start_date", dueDate: "due_date", actualDeliveryDate: "actual_delivery_date",
    lifecycleStatus: "lifecycle_status", progress: "progress", acceptanceCriteria: "acceptance_criteria", nextFollowupDate: "next_followup_date",
    completedAt: "completed_at", stopReason: "stop_reason", attachments: "attachments", createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
  },
  "supervision-task-progress": {
    id: "id", version: "version", taskId: "task_id", projectId: "project_id", updateType: "update_type", progress: "progress", summary: "summary",
    riskIssue: "risk_issue", nextAction: "next_action", nextFollowupDate: "next_followup_date", proposedDueDate: "proposed_due_date", changeReason: "change_reason",
    attachments: "attachments", createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
  }
};

@Injectable()
export class SupervisionFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry, private readonly dataSource: DataSource) {}

  onModuleInit() {
    for (const code of ["supervision-projects", "supervision-tasks", "supervision-task-progress"] as const) {
      const expressions = supervisionColumnExpressions(code, "record");
      this.registry.register({
        code, table: code === "supervision-projects" ? "supervision_projects" : code === "supervision-tasks" ? "supervision_tasks" : "supervision_task_progress",
        columns: physicalColumns[code], expressions: Object.fromEntries(Object.entries(expressions).filter(([key]) => !physicalColumns[code][key])),
        fields: tablePermissionFieldsFor(code),
        searchColumns: code === "supervision-projects" ? ["projectCode", "projectName", "projectDescription", "sourceName"] : code === "supervision-tasks" ? ["taskCode", "taskName", "description"] : ["summary", "riskIssue", "nextAction"],
        searchAliases: code === "supervision-projects" ? [
          { expression: "COALESCE((SELECT display_name FROM users WHERE id=record.owner_id),'')", permissionField: "ownerId" },
          { expression: "COALESCE((SELECT display_name FROM users WHERE id=record.supervisor_id),'')", permissionField: "supervisorId" }
        ] : code === "supervision-tasks" ? [
          { expression: "COALESCE((SELECT project_name FROM supervision_projects WHERE tenant_id=record.tenant_id AND id=record.project_id),'')", permissionField: "projectName" },
          { expression: "COALESCE((SELECT display_name FROM users WHERE id=record.owner_id),'')", permissionField: "ownerId" }
        ] : [],
        authorize: (actor) => { if (!hasSupervisionPermission(actor as SupervisionActor, code, "read")) throw new ForbiddenException("当前权限组没有此表的查看权限"); },
        buildScope: (actor, params, action) => supervisionScopeClause(actor as SupervisionActor, code, action ?? "read", "record", params),
        runQuery: (sql, params) => this.runWithTenant(sql, params)
      });
    }
  }

  private runWithTenant(sql: string, params: unknown[]) {
    const tenantId = String(params[0] ?? "");
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      return manager.query(sql, params);
    });
  }
}
