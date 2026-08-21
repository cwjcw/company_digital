import { availableDevelopmentActions } from "./development-request.workflow";

const request = (status: string) => ({ status, requesterId: "requester", requesterManagerId: "requester-manager", handlerId: "handler", handlerManagerId: "handler-manager" });
const actor = (id: string, roles: string[] = []) => ({ id, name: id, roles });

describe("development request workflow", () => {
  it("routes requester approval and admin assignment to the correct people", () => {
    expect(availableDevelopmentActions(request("PENDING_REQUESTER_APPROVAL"), actor("requester-manager"))).toEqual(["REQUESTER_APPROVE", "REQUESTER_REJECT"]);
    expect(availableDevelopmentActions(request("PENDING_ADMIN_ASSIGNMENT"), actor("admin", ["系统管理员"]))).toEqual(["ASSIGN"]);
    expect(availableDevelopmentActions(request("PENDING_ADMIN_ASSIGNMENT"), actor("requester-manager"))).toEqual([]);
  });

  it("allows rejected work to be revised by its owner", () => {
    expect(availableDevelopmentActions(request("REQUESTER_REJECTED"), actor("requester"))).toEqual(["RESUBMIT"]);
    expect(availableDevelopmentActions(request("HANDLER_MANAGER_REJECTED"), actor("handler"))).toEqual(["SUBMIT_PLAN"]);
  });

  it("routes the resource and schedule plan to the handler manager", () => {
    expect(availableDevelopmentActions(request("PENDING_HANDLER_PLAN"), actor("handler"))).toEqual(["SUBMIT_PLAN"]);
    expect(availableDevelopmentActions(request("PENDING_HANDLER_MANAGER_APPROVAL"), actor("handler-manager"))).toEqual(["HANDLER_APPROVE", "HANDLER_REJECT"]);
  });
});
