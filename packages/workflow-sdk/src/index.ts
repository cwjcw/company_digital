export type PlanningWorkflowType = "planning.plan.publish" | "planning.plan.major_change" | "planning.delivery_date.change" | "planning.plan.unlock" | "planning.period.close";
export interface WorkflowRequest { type: PlanningWorkflowType; tenantId: string; resourceId: string; requestedBy: string; reason: string; payload?: Record<string, unknown>; }
export interface WorkflowResult { requestId: string; status: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED"; }
export interface WorkflowGateway { request(input: WorkflowRequest): Promise<WorkflowResult>; }
export class PhaseOneWorkflowGateway implements WorkflowGateway {
  async request(input: WorkflowRequest): Promise<WorkflowResult> {
    return { requestId: `phase-one:${input.resourceId}`, status: "NOT_REQUIRED" };
  }
}
