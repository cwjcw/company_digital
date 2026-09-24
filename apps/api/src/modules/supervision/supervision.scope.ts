import { buildDataScopeClause } from "../../common/filtering/data-scope";
import type { SupervisionActor } from "./supervision.types";

export const supervisionResources = ["supervision-projects", "supervision-tasks", "supervision-task-progress"] as const;
export type SupervisionResource = typeof supervisionResources[number];

export function hasSupervisionPermission(actor: SupervisionActor, resource: string, action: string) {
  return actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("project-task") === true
    || actor.permissions.includes(`${resource}:*:${action}`);
}

export function hasSupervisionFieldPermission(actor: SupervisionActor, resource: string, field: string, action: "read" | "update") {
  return actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("project-task") === true
    || actor.permissions.includes(`${resource}:${field}:${action}`);
}

export function supervisionColumnExpressions(resource: SupervisionResource, alias = "record"): Record<string, string> {
  const display = `CASE WHEN ${alias}.lifecycle_status='COMPLETED' THEN 'COMPLETED' WHEN ${alias}.lifecycle_status='ABORTED' THEN 'ABORTED' WHEN ${alias}.due_date < (now() AT TIME ZONE 'Asia/Shanghai')::date THEN 'OVERDUE' ELSE 'NORMAL' END`;
  if (resource === "supervision-projects") return {
    projectCode: `${alias}.project_code`, projectName: `${alias}.project_name`, sourceType: `${alias}.source_type`, sourceName: `${alias}.source_name`, sourceDate: `${alias}.source_date`,
    ownerId: `${alias}.owner_id`, supervisorId: `${alias}.supervisor_id`, departmentId: `${alias}.department_id`, participantIds: `${alias}.participant_ids`, priority: `${alias}.priority`,
    plannedStartDate: `${alias}.planned_start_date`, dueDate: `${alias}.due_date`, lifecycleStatus: `${alias}.lifecycle_status`, displayStatus: display,
    progress: `COALESCE((SELECT round(avg(CASE WHEN task.lifecycle_status='COMPLETED' THEN 100 ELSE task.progress END),2) FROM supervision_tasks task WHERE task.tenant_id=${alias}.tenant_id AND task.project_id=${alias}.id AND task.lifecycle_status<>'ABORTED'),0)`,
    acceptanceCriteria: `${alias}.acceptance_criteria`, completionSummary: `${alias}.completion_summary`, stopReason: `${alias}.stop_reason`, attachments: `${alias}.attachments`, completedAt: `${alias}.completed_at`,
    createdBy: `${alias}.created_by`, createdAt: `${alias}.created_at`, updatedBy: `${alias}.updated_by`, updatedAt: `${alias}.updated_at`
  };
  if (resource === "supervision-tasks") return {
    taskCode: `${alias}.task_code`, projectId: `${alias}.project_id`, projectName: `(SELECT project.project_name FROM supervision_projects project WHERE project.tenant_id=${alias}.tenant_id AND project.id=${alias}.project_id)`,
    taskName: `${alias}.task_name`, description: `${alias}.description`, ownerId: `${alias}.owner_id`, collaboratorIds: `${alias}.collaborator_ids`, departmentId: `${alias}.department_id`, priority: `${alias}.priority`,
    plannedStartDate: `${alias}.planned_start_date`, dueDate: `${alias}.due_date`, lifecycleStatus: `${alias}.lifecycle_status`, displayStatus: display, progress: `${alias}.progress`,
    acceptanceCriteria: `${alias}.acceptance_criteria`, latestProgress: `(SELECT progress.summary FROM supervision_task_progress progress WHERE progress.tenant_id=${alias}.tenant_id AND progress.task_id=${alias}.id ORDER BY progress.created_at DESC,progress.id DESC LIMIT 1)`,
    nextFollowupDate: `${alias}.next_followup_date`, completedAt: `${alias}.completed_at`, stopReason: `${alias}.stop_reason`, attachments: `${alias}.attachments`,
    createdBy: `${alias}.created_by`, createdAt: `${alias}.created_at`, updatedBy: `${alias}.updated_by`, updatedAt: `${alias}.updated_at`
  };
  return {
    taskId: `${alias}.task_id`, projectId: `${alias}.project_id`, updateType: `${alias}.update_type`, progress: `${alias}.progress`, summary: `${alias}.summary`, riskIssue: `${alias}.risk_issue`,
    nextAction: `${alias}.next_action`, nextFollowupDate: `${alias}.next_followup_date`, proposedDueDate: `${alias}.proposed_due_date`, changeReason: `${alias}.change_reason`, attachments: `${alias}.attachments`,
    createdBy: `${alias}.created_by`, createdAt: `${alias}.created_at`, updatedBy: `${alias}.updated_by`, updatedAt: `${alias}.updated_at`
  };
}

export function supervisionScopeClause(actor: SupervisionActor, resource: SupervisionResource, action: string, alias: string, params: unknown[]) {
  if (actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("project-task") === true) return "1=1";
  const scopes = (actor.tableDataScopes ?? []).filter((scope) => scope.resource === resource && (!scope.actions || scope.actions.includes(action)));
  const expressions = supervisionColumnExpressions(resource, alias);
  const generic = buildDataScopeClause({ resource, action, columns: expressions, actor, params, expression: (value) => value });
  if (!actor.userId || !scopes.some((scope) => scope.scope === "OWN")) return generic;
  params.push(actor.userId); const user = `$${params.length}::uuid`;
  const own = resource === "supervision-projects"
    ? `(${alias}.created_by=${user} OR ${alias}.owner_id=${user} OR ${alias}.supervisor_id=${user} OR ${alias}.participant_ids ? ${user}::text)`
    : resource === "supervision-tasks"
      ? `(${alias}.created_by=${user} OR ${alias}.owner_id=${user} OR ${alias}.collaborator_ids ? ${user}::text OR EXISTS(SELECT 1 FROM supervision_projects own_project WHERE own_project.tenant_id=${alias}.tenant_id AND own_project.id=${alias}.project_id AND (own_project.owner_id=${user} OR own_project.supervisor_id=${user} OR own_project.participant_ids ? ${user}::text)))`
      : `(${alias}.created_by=${user} OR EXISTS(SELECT 1 FROM supervision_tasks own_task WHERE own_task.tenant_id=${alias}.tenant_id AND own_task.id=${alias}.task_id AND (own_task.owner_id=${user} OR own_task.collaborator_ids ? ${user}::text OR EXISTS(SELECT 1 FROM supervision_projects own_project WHERE own_project.tenant_id=own_task.tenant_id AND own_project.id=own_task.project_id AND (own_project.owner_id=${user} OR own_project.supervisor_id=${user} OR own_project.participant_ids ? ${user}::text)))))`;
  return generic === "1=0" ? own : `(${generic} OR ${own})`;
}
