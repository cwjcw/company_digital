import { approvalCapabilities, type ApprovalStage, type ApprovalTransition } from "@kdos/workflow-sdk";

export const developmentRequestStages = [
  { key: "DRAFT", label: "创建并填写", order: 0 },
  { key: "PENDING_REQUESTER_APPROVAL", label: "填写人上级审批", order: 1 },
  { key: "PENDING_ADMIN_ASSIGNMENT", label: "管理员分配", order: 2 },
  { key: "PENDING_HANDLER_PLAN", label: "资源与工期评估", order: 3 },
  { key: "PENDING_HANDLER_MANAGER_APPROVAL", label: "处理人上级审批", order: 4 },
  { key: "APPROVED_FOR_DEVELOPMENT", label: "已批准开发", order: 5, terminal: true }
] as const satisfies readonly ApprovalStage[];

export type DevelopmentRequestStatus = typeof developmentRequestStages[number]["key"];
export type DevelopmentRequestAction =
  | "EDIT_DRAFT" | "SUBMIT" | "WITHDRAW" | "RETURN" | "REJECT"
  | "REQUESTER_APPROVE" | "ASSIGN" | "SUBMIT_PLAN" | "HANDLER_APPROVE";
export type DevelopmentActor = { id: string; name: string; roles: string[] };
export type DevelopmentWorkflowEvent = { actorId: string; action: string; fromStatus: string | null; toStatus: string };
export type DevelopmentWorkflowPolicy = {
  allowWithdraw: boolean;
  returnMode: "ANY_PREVIOUS" | "PREVIOUS_ONLY";
  adminRoleNames: string[];
  nodeLabels: Record<string, string>;
};

export const defaultDevelopmentWorkflowPolicy: DevelopmentWorkflowPolicy = {
  allowWithdraw: true,
  returnMode: "ANY_PREVIOUS",
  adminRoleNames: ["系统管理员", "集团管理员"],
  nodeLabels: {}
};

const forwardActions = new Set(["SUBMIT", "RESUBMIT", "REQUESTER_APPROVE", "ASSIGN", "SUBMIT_PLAN"]);

export function configuredDevelopmentStages(policy: Partial<DevelopmentWorkflowPolicy> = {}) {
  const labels = policy.nodeLabels ?? {};
  return developmentRequestStages.map((stage) => ({ ...stage, label: labels[stage.key] || stage.label }));
}

export function isDevelopmentAdmin(actor: DevelopmentActor, adminRoleNames = defaultDevelopmentWorkflowPolicy.adminRoleNames) {
  return actor.roles.some((role) => adminRoleNames.includes(role));
}

function isCurrentNodeActor(request: {
  status: string;
  requesterId: string;
  requesterManagerId: string | null;
  handlerId: string | null;
  handlerManagerId: string | null;
}, actor: DevelopmentActor, policy: DevelopmentWorkflowPolicy) {
  if (request.status === "PENDING_REQUESTER_APPROVAL") return request.requesterManagerId === actor.id;
  if (request.status === "PENDING_ADMIN_ASSIGNMENT") return isDevelopmentAdmin(actor, policy.adminRoleNames);
  if (request.status === "PENDING_HANDLER_PLAN") return request.handlerId === actor.id;
  if (request.status === "PENDING_HANDLER_MANAGER_APPROVAL") return request.handlerManagerId === actor.id;
  return false;
}

function transition(event?: DevelopmentWorkflowEvent | null): ApprovalTransition | null {
  return event ? {
    actorId: event.actorId,
    fromStage: event.fromStatus,
    toStage: event.toStatus,
    withdrawable: forwardActions.has(event.action)
  } : null;
}

export function developmentApprovalCapabilities(request: {
  status: string;
  requesterId: string;
  requesterManagerId: string | null;
  handlerId: string | null;
  handlerManagerId: string | null;
}, actor: DevelopmentActor, latestEvent?: DevelopmentWorkflowEvent | null, inputPolicy: Partial<DevelopmentWorkflowPolicy> = {}) {
  const policy = { ...defaultDevelopmentWorkflowPolicy, ...inputPolicy };
  const stages = configuredDevelopmentStages(policy);
  const capabilities = approvalCapabilities({
    stages,
    currentStage: request.status,
    actorId: actor.id,
    isCurrentNodeActor: isCurrentNodeActor(request, actor, policy),
    latestTransition: transition(latestEvent)
  });
  if (!policy.allowWithdraw) capabilities.canWithdraw = false;
  if (policy.returnMode === "PREVIOUS_ONLY" && capabilities.returnTargets.length > 1) {
    capabilities.returnTargets = capabilities.returnTargets.slice(-1);
  }
  return capabilities;
}

export function availableDevelopmentActions(request: {
  status: string;
  requesterId: string;
  requesterManagerId: string | null;
  handlerId: string | null;
  handlerManagerId: string | null;
}, actor: DevelopmentActor, latestEvent?: DevelopmentWorkflowEvent | null, inputPolicy: Partial<DevelopmentWorkflowPolicy> = {}): DevelopmentRequestAction[] {
  const policy = { ...defaultDevelopmentWorkflowPolicy, ...inputPolicy };
  const actions: DevelopmentRequestAction[] = [];
  if (request.status === "DRAFT" && request.requesterId === actor.id) actions.push("EDIT_DRAFT", "SUBMIT");
  if (request.status === "PENDING_REQUESTER_APPROVAL" && request.requesterManagerId === actor.id) actions.push("REQUESTER_APPROVE", "REJECT");
  if (request.status === "PENDING_ADMIN_ASSIGNMENT" && isDevelopmentAdmin(actor, policy.adminRoleNames)) actions.push("ASSIGN");
  if (request.status === "PENDING_HANDLER_PLAN" && request.handlerId === actor.id) actions.push("SUBMIT_PLAN");
  if (request.status === "PENDING_HANDLER_MANAGER_APPROVAL" && request.handlerManagerId === actor.id) actions.push("HANDLER_APPROVE", "REJECT");
  const capabilities = developmentApprovalCapabilities(request, actor, latestEvent, policy);
  if (capabilities.returnTargets.length) actions.push("RETURN");
  if (capabilities.canWithdraw) actions.push("WITHDRAW");
  return actions;
}
