export const developmentRequestStatuses = [
  "PENDING_REQUESTER_APPROVAL",
  "REQUESTER_REJECTED",
  "PENDING_ADMIN_ASSIGNMENT",
  "PENDING_HANDLER_PLAN",
  "PENDING_HANDLER_MANAGER_APPROVAL",
  "HANDLER_MANAGER_REJECTED",
  "APPROVED_FOR_DEVELOPMENT"
] as const;

export type DevelopmentRequestStatus = typeof developmentRequestStatuses[number];
export type DevelopmentRequestAction = "RESUBMIT" | "REQUESTER_APPROVE" | "REQUESTER_REJECT" | "ASSIGN" | "SUBMIT_PLAN" | "HANDLER_APPROVE" | "HANDLER_REJECT";
export type DevelopmentActor = { id: string; name: string; roles: string[] };

export function isDevelopmentAdmin(actor: DevelopmentActor) {
  return actor.roles.some((role) => role === "系统管理员" || role === "集团管理员");
}
export function availableDevelopmentActions(request: {
  status: string;
  requesterId: string;
  requesterManagerId: string;
  handlerId: string | null;
  handlerManagerId: string | null;
}, actor: DevelopmentActor): DevelopmentRequestAction[] {
  const actions: DevelopmentRequestAction[] = [];
  if (request.status === "REQUESTER_REJECTED" && request.requesterId === actor.id) actions.push("RESUBMIT");
  if (request.status === "PENDING_REQUESTER_APPROVAL" && request.requesterManagerId === actor.id) actions.push("REQUESTER_APPROVE", "REQUESTER_REJECT");
  if (request.status === "PENDING_ADMIN_ASSIGNMENT" && isDevelopmentAdmin(actor)) actions.push("ASSIGN");
  if (["PENDING_HANDLER_PLAN", "HANDLER_MANAGER_REJECTED"].includes(request.status) && request.handlerId === actor.id) actions.push("SUBMIT_PLAN");
  if (request.status === "PENDING_HANDLER_MANAGER_APPROVAL" && request.handlerManagerId === actor.id) actions.push("HANDLER_APPROVE", "HANDLER_REJECT");
  return actions;
}
