import { availableDevelopmentActions, developmentApprovalCapabilities } from "./development-request.workflow";

const request = (status: string) => ({ status, requesterId: "requester", requesterManagerId: "requester-manager", handlerId: "handler", handlerManagerId: "handler-manager" });
const actor = (id: string, roles: string[] = []) => ({ id, name: id, roles });
const event = (actorId: string, action: string, fromStatus: string, toStatus: string) => ({ actorId, action, fromStatus, toStatus });

describe("development request workflow", () => {
  it("supports editable drafts and submission by their creator", () => {
    expect(availableDevelopmentActions(request("DRAFT"), actor("requester"))).toEqual(["EDIT_DRAFT", "SUBMIT"]);
    expect(availableDevelopmentActions(request("DRAFT"), actor("requester-manager"))).toEqual([]);
  });

  it("routes each active node to the responsible person", () => {
    expect(availableDevelopmentActions(request("PENDING_REQUESTER_APPROVAL"), actor("requester-manager"))).toEqual(["REQUESTER_APPROVE", "REJECT", "RETURN"]);
    expect(availableDevelopmentActions(request("PENDING_ADMIN_ASSIGNMENT"), actor("admin", ["系统管理员"]))).toEqual(["ASSIGN", "RETURN"]);
    expect(availableDevelopmentActions(request("PENDING_HANDLER_PLAN"), actor("handler"))).toEqual(["SUBMIT_PLAN", "RETURN"]);
    expect(availableDevelopmentActions(request("PENDING_HANDLER_MANAGER_APPROVAL"), actor("handler-manager"))).toEqual(["HANDLER_APPROVE", "REJECT", "RETURN"]);
  });

  it("lets a submitter withdraw while the immediately following node has not acted", () => {
    const latest = event("requester", "SUBMIT", "DRAFT", "PENDING_REQUESTER_APPROVAL");
    expect(availableDevelopmentActions(request("PENDING_REQUESTER_APPROVAL"), actor("requester"), latest)).toEqual(["WITHDRAW"]);
    expect(availableDevelopmentActions(request("PENDING_REQUESTER_APPROVAL"), actor("other"), latest)).toEqual([]);
  });

  it("allows the current actor to select any earlier stage as a return target", () => {
    expect(developmentApprovalCapabilities(request("PENDING_HANDLER_MANAGER_APPROVAL"), actor("handler-manager")).returnTargets.map((stage) => stage.key)).toEqual([
      "DRAFT", "PENDING_REQUESTER_APPROVAL", "PENDING_ADMIN_ASSIGNMENT", "PENDING_HANDLER_PLAN"
    ]);
  });

  it("can restrict return and withdrawal using runtime configuration", () => {
    const latest = event("requester", "SUBMIT", "DRAFT", "PENDING_REQUESTER_APPROVAL");
    expect(availableDevelopmentActions(request("PENDING_REQUESTER_APPROVAL"), actor("requester"), latest, { allowWithdraw: false })).toEqual([]);
    expect(developmentApprovalCapabilities(request("PENDING_HANDLER_MANAGER_APPROVAL"), actor("handler-manager"), null, { returnMode: "PREVIOUS_ONLY" }).returnTargets.map((stage) => stage.key)).toEqual(["PENDING_HANDLER_PLAN"]);
  });

  it("uses configured roles and node labels", () => {
    const policy = { adminRoleNames: ["研发管理员"], nodeLabels: { PENDING_ADMIN_ASSIGNMENT: "研发中心分配" } };
    expect(availableDevelopmentActions(request("PENDING_ADMIN_ASSIGNMENT"), actor("admin", ["系统管理员"]), null, policy)).toEqual([]);
    expect(availableDevelopmentActions(request("PENDING_ADMIN_ASSIGNMENT"), actor("dev-admin", ["研发管理员"]), null, policy)).toEqual(["ASSIGN", "RETURN"]);
    expect(developmentApprovalCapabilities(request("PENDING_HANDLER_PLAN"), actor("handler"), null, policy).returnTargets.at(-1)?.label).toBe("研发中心分配");
  });

  it("does not expose workflow operations after final approval", () => {
    expect(availableDevelopmentActions(request("APPROVED_FOR_DEVELOPMENT"), actor("handler-manager"))).toEqual([]);
  });
});
