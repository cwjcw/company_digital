import { approvalCapabilities, assertEarlierApprovalStage, type ApprovalStage } from "./index";
import { describe, expect, it } from "vitest";

const stages: ApprovalStage[] = [
  { key: "DRAFT", label: "创建", order: 0 },
  { key: "MANAGER", label: "直属领导审批", order: 1 },
  { key: "ADMIN", label: "管理员处理", order: 2 },
  { key: "DONE", label: "结束", order: 3, terminal: true }
];

describe("shared approval flow policy", () => {
  it("lets the previous submitter withdraw only before the next node acts", () => {
    expect(approvalCapabilities({
      stages, currentStage: "MANAGER", actorId: "requester", isCurrentNodeActor: false,
      latestTransition: { actorId: "requester", fromStage: "DRAFT", toStage: "MANAGER", withdrawable: true }
    })).toMatchObject({ canWithdraw: true, withdrawTarget: { key: "DRAFT" } });
    expect(approvalCapabilities({
      stages, currentStage: "ADMIN", actorId: "requester", isCurrentNodeActor: false,
      latestTransition: { actorId: "manager", fromStage: "MANAGER", toStage: "ADMIN", withdrawable: true }
    }).canWithdraw).toBe(false);
  });

  it("lets the current node actor return to any earlier non-terminal stage", () => {
    expect(approvalCapabilities({ stages, currentStage: "ADMIN", actorId: "admin", isCurrentNodeActor: true }).returnTargets.map((stage) => stage.key)).toEqual(["DRAFT", "MANAGER"]);
    expect(assertEarlierApprovalStage(stages, "ADMIN", "DRAFT").key).toBe("DRAFT");
    expect(() => assertEarlierApprovalStage(stages, "MANAGER", "DONE")).toThrow("退回目标必须是当前环节之前的有效环节");
  });

  it("does not allow return or withdrawal after the flow is complete", () => {
    expect(approvalCapabilities({ stages, currentStage: "DONE", actorId: "manager", isCurrentNodeActor: true }).returnTargets).toEqual([]);
  });
});
