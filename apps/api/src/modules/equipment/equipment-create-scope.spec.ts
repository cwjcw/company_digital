import { equipmentCreateAllowed, equipmentCreateScope, equipmentCreateScopeClause, type EquipmentActor } from "./equipment.types";
import { EquipmentApplicationService } from "./equipment.application.service";
import { EquipmentQueryService } from "./equipment.query.service";

/**
 * KN-EQUIP-001：设备状态填报「候选设备集合」必须严格等于「保存允许新增的设备集合」。
 * 覆盖：事业一部 create 用户 + 事业一部设备（允许）、+ 事业二部设备（403）、系统管理员（全事业部）、
 * 无 create 权限（403）、候选只返回允许事业部、多权限组组合不扩大/不收窄。
 */
const DIVISION_ONE = "ad238002-66e1-47db-94c6-8680e25fcf33";
const DIVISION_TWO = "2493437b-e43b-4867-ba51-d7eb5c305954";

const RESOURCE = "equipment-status-report";

function actor(overrides: Partial<EquipmentActor> = {}): EquipmentActor {
  return {
    tenantId: "KAINAN", userId: "u1", username: "测试用户", permissions: [`${RESOURCE}:*:create`, `${RESOURCE}:*:read`],
    tableDataScopes: [{
      resource: RESOURCE, scope: "CUSTOM", match: "ALL", actions: ["read", "create"],
      rules: [{ fieldKey: "divisionId", operator: "EQ", value: DIVISION_ONE }]
    }],
    requestId: "req-1", source: "web", ...overrides
  };
}

describe("KN-EQUIP-001 create 范围唯一性", () => {
  it("A: 事业一部 create 用户 + 事业一部设备 → 允许新增", () => {
    expect(equipmentCreateAllowed(actor(), RESOURCE, DIVISION_ONE)).toBe(true);
  });

  it("B: 事业一部 create 用户 + 事业二部设备 → 拒绝（403 语义）", () => {
    expect(equipmentCreateAllowed(actor(), RESOURCE, DIVISION_TWO)).toBe(false);
    expect(equipmentCreateScope(actor(), RESOURCE)).toEqual({ unrestricted: false, divisionIds: [DIVISION_ONE] });
  });

  it("C/D: 候选 SQL 与保存校验同源：候选范围 = 允许新增范围", () => {
    const params: unknown[] = ["KAINAN"];
    const clause = equipmentCreateScopeClause(actor(), RESOURCE, "asset", params);
    expect(clause).toBe("asset.division_organization_unit_id=ANY($2::uuid[])");
    expect(params[1]).toEqual([DIVISION_ONE]);
    /* 同一 actor 下，clause 允许的事业部集合与记录级校验一致。 */
    expect(equipmentCreateAllowed(actor(), RESOURCE, DIVISION_ONE)).toBe(true);
    expect(equipmentCreateAllowed(actor(), RESOURCE, DIVISION_TWO)).toBe(false);
  });

  it("E: 系统管理员不受事业部限制", () => {
    const admin = actor({ isSystemAdmin: true, permissions: ["*"], tableDataScopes: [] });
    expect(equipmentCreateScope(admin, RESOURCE).unrestricted).toBe(true);
    expect(equipmentCreateAllowed(admin, RESOURCE, DIVISION_TWO)).toBe(true);
    const params: unknown[] = ["KAINAN"];
    expect(equipmentCreateScopeClause(admin, RESOURCE, "asset", params)).toBe("1=1");
  });

  it("G: 没有 create 权限（仅有 read 的数据范围）→ 候选为空且不允许新增", () => {
    const readOnly = actor({
      permissions: [`${RESOURCE}:*:read`],
      tableDataScopes: [{ resource: RESOURCE, scope: "CUSTOM", match: "ALL", actions: ["read"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: DIVISION_ONE }] }]
    });
    expect(equipmentCreateScope(readOnly, RESOURCE)).toEqual({ unrestricted: false, divisionIds: [] });
    expect(equipmentCreateAllowed(readOnly, RESOURCE, DIVISION_ONE)).toBe(false);
    const params: unknown[] = ["KAINAN"];
    expect(equipmentCreateScopeClause(readOnly, RESOURCE, "asset", params)).toBe("1=0");
  });

  it("H: 多权限组组合（CUSTOM 事业一部 + CUSTOM 事业二部 + 只读组）→ 候选与保存范围一致且不扩大", () => {
    const multi = actor({
      tableDataScopes: [
        { resource: RESOURCE, scope: "CUSTOM", match: "ALL", actions: ["read", "create"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: DIVISION_ONE }] },
        { resource: RESOURCE, scope: "CUSTOM", match: "ALL", actions: ["create"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: DIVISION_TWO }] },
        { resource: RESOURCE, scope: "CUSTOM", match: "ALL", actions: ["read"], rules: [] }
      ]
    });
    const scope = equipmentCreateScope(multi, RESOURCE);
    expect(scope.divisionIds.sort()).toEqual([DIVISION_ONE, DIVISION_TWO].sort());
    /* 两个 CUSTOM 组都属于 create，两个事业部都允许；第三个只读组不参与。 */
    expect(equipmentCreateAllowed(multi, RESOURCE, DIVISION_ONE)).toBe(true);
    expect(equipmentCreateAllowed(multi, RESOURCE, DIVISION_TWO)).toBe(true);
    const params: unknown[] = ["KAINAN"];
    equipmentCreateScopeClause(multi, RESOURCE, "asset", params);
    expect(params[1]).toEqual(expect.arrayContaining([DIVISION_ONE, DIVISION_TWO]));
  });

  it("H2: 一个组的 create 范围是事业一部，另一个组只有 read 的 ALL → 不会因为 read 的 ALL 扩大 create 范围", () => {
    const mixed = actor({
      tableDataScopes: [
        { resource: RESOURCE, scope: "CUSTOM", match: "ALL", actions: ["create"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: DIVISION_ONE }] },
        { resource: RESOURCE, scope: "ALL", match: "ALL", actions: ["read"], rules: [] }
      ]
    });
    expect(equipmentCreateScope(mixed, RESOURCE).divisionIds).toEqual([DIVISION_ONE]);
    expect(equipmentCreateAllowed(mixed, RESOURCE, DIVISION_TWO)).toBe(false);
  });

  it("F: 保存路径对越权设备抛 403「超出事业部数据范围」（saveStatus 校验）", async () => {
    const service = new EquipmentApplicationService({} as never);
    const assertRecordAccess = (service as unknown as { assertRecordAccess: (a: EquipmentActor, r: string, action: string, divisionId: string, createdBy: string | null) => void }).assertRecordAccess.bind(service);
    expect(() => assertRecordAccess(actor(), RESOURCE, "create", DIVISION_ONE, null)).not.toThrow();
    expect(() => assertRecordAccess(actor(), RESOURCE, "create", DIVISION_TWO, null)).toThrow(/超出事业部数据范围/);
  });

  it("候选设备 SQL 使用 create 范围（status-options 只返回允许的事业部）", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const dataSource = {
      query: async (sql: string, params: unknown[]) => { queries.push({ sql, params }); return []; }
    } as never;
    const service = new EquipmentQueryService(dataSource);
    await service.statusFormOptions(actor());
    const equipmentQuery = queries.find((entry) => entry.sql.includes("FROM equipment_assets"));
    expect(equipmentQuery).toBeTruthy();
    expect(equipmentQuery!.sql).toContain("asset.division_organization_unit_id=ANY(");
    expect(equipmentQuery!.params).toContainEqual([DIVISION_ONE]);
    expect(equipmentQuery!.params).not.toContainEqual([DIVISION_TWO]);
  });
});
