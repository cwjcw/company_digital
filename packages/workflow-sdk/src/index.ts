export type PlanningWorkflowType = "planning.plan.publish" | "planning.plan.major_change" | "planning.delivery_date.change" | "planning.plan.unlock" | "planning.period.close";
export interface WorkflowRequest { type: PlanningWorkflowType; tenantId: string; resourceId: string; requestedBy: string; reason: string; payload?: Record<string, unknown>; }
export interface WorkflowResult { requestId: string; status: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED"; }
export interface WorkflowGateway { request(input: WorkflowRequest): Promise<WorkflowResult>; }
export class PhaseOneWorkflowGateway implements WorkflowGateway {
  async request(input: WorkflowRequest): Promise<WorkflowResult> {
    return { requestId: `phase-one:${input.resourceId}`, status: "NOT_REQUIRED" };
  }
}

/**
 * Shared policy for every human approval flow in KDOS.
 *
 * Business modules keep their own records and assignee rules, while this policy
 * consistently enforces draft submission, withdrawal before the next node acts,
 * and return to any earlier stage.
 */
export interface ApprovalStage {
  key: string;
  label: string;
  order: number;
  terminal?: boolean;
}

export interface ApprovalTransition {
  actorId: string;
  fromStage: string | null;
  toStage: string;
  withdrawable: boolean;
}

export interface ApprovalCapabilities {
  canWithdraw: boolean;
  withdrawTarget: ApprovalStage | null;
  returnTargets: ApprovalStage[];
}

export function approvalCapabilities(input: {
  stages: readonly ApprovalStage[];
  currentStage: string;
  actorId: string;
  isCurrentNodeActor: boolean;
  latestTransition?: ApprovalTransition | null;
}): ApprovalCapabilities {
  const ordered = [...input.stages].sort((left, right) => left.order - right.order);
  const current = ordered.find((stage) => stage.key === input.currentStage);
  if (!current) throw new Error(`Unknown approval stage: ${input.currentStage}`);
  const earlier = ordered.filter((stage) => !stage.terminal && stage.order < current.order);
  const latest = input.latestTransition;
  const withdrawTarget = latest?.fromStage ? ordered.find((stage) => stage.key === latest.fromStage) ?? null : null;
  const canWithdraw = Boolean(
    !current.terminal && latest?.withdrawable && latest.actorId === input.actorId &&
    latest.toStage === current.key && withdrawTarget && withdrawTarget.order < current.order
  );
  return {
    canWithdraw,
    withdrawTarget: canWithdraw ? withdrawTarget : null,
    returnTargets: !current.terminal && input.isCurrentNodeActor ? earlier : []
  };
}

export function assertEarlierApprovalStage(stages: readonly ApprovalStage[], currentStage: string, targetStage: string) {
  const current = stages.find((stage) => stage.key === currentStage);
  const target = stages.find((stage) => stage.key === targetStage);
  if (!current || !target || target.terminal || target.order >= current.order) throw new Error("退回目标必须是当前环节之前的有效环节");
  return target;
}
