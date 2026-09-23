import { EquipmentStatusReport, EquipmentAsset, DictionaryValue } from "../../entities";
import { EquipmentApplicationService } from "./equipment.application.service";
import type { EquipmentActor } from "./equipment.types";

const actor: EquipmentActor = {
  tenantId: "KAINAN", userId: "00000000-0000-7000-8000-000000000001", username: "tester",
  permissions: ["*"], tableDataScopes: [], requestId: "equipment-notification-test"
};

const reportDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

function harness(oldFaultMinutes: number | null) {
  const asset = {
    id: "asset-1", tenantId: "KAINAN", active: true, monitored: true,
    divisionOrganizationUnitId: "division-1", divisionNameSnapshot: "事业一部",
    usageDepartmentOrganizationUnitId: "department-1", usageDepartmentNameSnapshot: "下料中心",
    equipmentCode: "EQ-001", equipmentName: "冲床甲"
  } as EquipmentAsset;
  const current = oldFaultMinutes == null ? null : {
    id: "status-1", tenantId: "KAINAN", equipmentId: asset.id,
    divisionOrganizationUnitId: asset.divisionOrganizationUnitId,
    usageDepartmentOrganizationUnitId: asset.usageDepartmentOrganizationUnitId,
    equipmentCodeSnapshot: asset.equipmentCode, equipmentNameSnapshot: asset.equipmentName,
    divisionNameSnapshot: asset.divisionNameSnapshot,
    usageDepartmentNameSnapshot: asset.usageDepartmentNameSnapshot,
    reportDate, plannedRuntimeMinutes: 600, runtimeMinutes: 300,
    faultMinutes: oldFaultMinutes, faultReason: oldFaultMinutes > 0 ? "机械故障" : null,
    active: true, version: 3, createdBy: actor.userId, updatedBy: actor.userId
  } as EquipmentStatusReport;
  const dictionaryQuery = {
    innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue({ id: "fault-reason-1", value: "机械故障" })
  };
  const reportQuery = {
    setLock: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(current)
  };
  const manager = {
    findOneBy: jest.fn().mockResolvedValue(asset),
    createQueryBuilder: jest.fn((entity: unknown) => entity === DictionaryValue ? dictionaryQuery : reportQuery),
    create: jest.fn((_entity: unknown, value: object) => ({ id: "status-1", ...value })),
    save: jest.fn().mockImplementation((_entity: unknown, value: object) => Promise.resolve(value))
  };
  const notifications = { enqueueEvent: jest.fn().mockResolvedValue({ created: true, row: {} }) };
  const dataSource = { transaction: jest.fn((work: (value: typeof manager) => unknown) => work(manager)) };
  const service = new EquipmentApplicationService(dataSource as never, notifications as never) as any;
  return { asset, current, manager, notifications, service };
}

async function updateFault(oldFaultMinutes: number, newFaultMinutes: number, changes: Record<string, unknown> = {}) {
  const fixture = harness(oldFaultMinutes);
  await fixture.service.saveStatus(fixture.manager, "status-1", {
    equipmentId: "asset-1", reportDate, plannedRuntimeMinutes: 600, runtimeMinutes: 300,
    faultMinutes: newFaultMinutes, faultReason: newFaultMinutes > 0 ? "机械故障" : null,
    expectedVersion: 3, ...changes
  }, actor, "update");
  return fixture;
}

describe("equipment fault change notification", () => {
  it("emits 0→60 on a new status record and keeps report, audit and outbox on the same manager", async () => {
    const fixture = harness(null);
    await fixture.service.createStatus({
      equipmentId: "asset-1", reportDate, plannedRuntimeMinutes: 600, runtimeMinutes: 300,
      faultMinutes: 60, faultReason: "机械故障"
    }, actor);

    expect(fixture.notifications.enqueueEvent).toHaveBeenCalledTimes(1);
    const [tenantId, event, manager] = fixture.notifications.enqueueEvent.mock.calls[0]!;
    expect(tenantId).toBe("KAINAN");
    expect(manager).toBe(fixture.manager);
    expect(event).toMatchObject({
      eventType: "equipment.status.fault_changed",
      channel: "WECHAT_WORK",
      dedupKey: "equipment-status-report:status-1:1:equipment.status.fault_changed",
      payload: {
        equipmentId: "asset-1", equipmentCode: "EQ-001", equipmentName: "冲床甲",
        divisionId: "division-1", divisionName: "事业一部", oldFaultMinutes: 0,
        newFaultMinutes: 60, faultReason: "机械故障", actorUserId: actor.userId, actorName: actor.username
      }
    });
    expect(Math.max(...fixture.manager.save.mock.invocationCallOrder)).toBeLessThan(fixture.notifications.enqueueEvent.mock.invocationCallOrder[0]!);
  });

  it.each([
    [0, 60, {}, true],
    [60, 90, {}, true],
    [60, 60, {}, false],
    [60, 60, { faultReason: "电气故障" }, false],
    [60, 60, { runtimeMinutes: 360 }, false],
    [90, 0, { faultReason: null }, false]
  ])("handles %i→%i without unrelated notification (%s)", async (oldFault, newFault, changes, shouldNotify) => {
    const fixture = await updateFault(oldFault, newFault, changes as Record<string, unknown>);
    expect(fixture.notifications.enqueueEvent).toHaveBeenCalledTimes(shouldNotify ? 1 : 0);
    if (shouldNotify) expect(fixture.notifications.enqueueEvent.mock.calls[0]![1].payload).toMatchObject({ oldFaultMinutes: oldFault, newFaultMinutes: newFault });
  });
});
