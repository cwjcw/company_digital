import { BadRequestException } from "@nestjs/common";
import { EquipmentApplicationService } from "./equipment.application.service";
import { EquipmentImportService } from "./equipment-import.service";
import { EquipmentQueryService } from "./equipment.query.service";
import { equipmentScope, hasEquipmentPermission, type EquipmentActor } from "./equipment.types";

const actor = (overrides: Partial<EquipmentActor> = {}): EquipmentActor => ({
  tenantId: "KAINAN", userId: "00000000-0000-7000-8000-000000000001", username: "tester",
  permissions: ["equipment-status-report:*:read"], tableDataScopes: [], requestId: "test", ...overrides
});

describe("equipment permissions and validation", () => {
  it("recognizes explicit and wildcard resource permissions", () => {
    expect(hasEquipmentPermission(actor(), "equipment-status-report", "read")).toBe(true);
    expect(hasEquipmentPermission(actor(), "equipment-status-report", "update")).toBe(false);
    expect(hasEquipmentPermission(actor({ permissions: ["*"] }), "equipment-register", "delete")).toBe(true);
  });

  it("extracts division IDs from EQ and IN rules without widening scope", () => {
    const scoped = equipmentScope(actor({ tableDataScopes: [{
      resource: "equipment-status-report", scope: "CUSTOM", match: "ANY", actions: ["read"], rules: [
        { fieldKey: "divisionId", operator: "EQ", value: "division-1" },
        { fieldKey: "divisionId", operator: "IN", value: ["division-2", "division-3"] },
        { fieldKey: "equipmentName", operator: "EQ", value: "不可用于扩大事业部范围" }
      ]
    }] }), "equipment-status-report", "read");
    expect(scoped).toEqual({ unrestricted: false, divisionIds: ["division-1", "division-2", "division-3"] });
  });

  it("intersects ALL division rules and fails closed for unsupported narrowing rules", () => {
    const common = { resource: "equipment-register", scope: "CUSTOM", match: "ALL", actions: ["read"] };
    expect(equipmentScope(actor({ tableDataScopes: [{ ...common, rules: [
      { fieldKey: "divisionId", operator: "IN", value: ["d1", "d2"] },
      { fieldKey: "divisionId", operator: "EQ", value: "d2" }
    ] }] }), "equipment-register", "read").divisionIds).toEqual(["d2"]);
    expect(equipmentScope(actor({ tableDataScopes: [{ ...common, rules: [
      { fieldKey: "divisionId", operator: "EQ", value: "d2" },
      { fieldKey: "equipmentName", operator: "EQ", value: "精密设备" }
    ] }] }), "equipment-register", "read").divisionIds).toEqual([]);
  });

  it("honors ALL scope and refuses a scope configured for another action", () => {
    const all = equipmentScope(actor({ tableDataScopes: [{ resource: "equipment-dashboard", scope: "ALL", actions: ["read"] }] }), "equipment-dashboard", "read");
    expect(all.unrestricted).toBe(true);
    const none = equipmentScope(actor({ tableDataScopes: [{ resource: "equipment-dashboard", scope: "ALL", actions: ["update"] }] }), "equipment-dashboard", "read");
    expect(none).toEqual({ unrestricted: false, divisionIds: [] });
  });

  it("accepts today and the previous six days but rejects dates outside the rolling week", () => {
    const service = new EquipmentApplicationService({} as never) as any;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const date = new Date(`${today}T00:00:00+08:00`);
    const offset = (days: number) => {
      const value = new Date(date); value.setDate(value.getDate() + days);
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
    };
    expect(service.reportDate(today)).toBe(today);
    expect(service.reportDate(offset(-6))).toBe(offset(-6));
    expect(() => service.reportDate(offset(-7))).toThrow(BadRequestException);
    expect(() => service.reportDate(offset(1))).toThrow(BadRequestException);
  });

  it("stores durations as exact non-negative integer minutes", () => {
    const service = new EquipmentApplicationService({} as never) as any;
    expect(service.minutes(undefined, "运行时长")).toBe(0);
    expect(service.minutes(125, "运行时长")).toBe(125);
    expect(() => service.minutes(-1, "运行时长")).toThrow(BadRequestException);
    expect(() => service.minutes(1.5, "运行时长")).toThrow(BadRequestException);
  });

  it("uses server-validated calendar bounds for dashboard filters", () => {
    const service = new EquipmentQueryService({} as never) as any;
    expect(service.dashboardInput({ periodType: "month", period: "2026-09" })).toMatchObject({ windowStart: "2026-09-01", windowEnd: "2026-09-30", windowDays: 30 });
    expect(service.dashboardInput({ periodType: "year", period: "2024" })).toMatchObject({ windowStart: "2024-01-01", windowEnd: "2024-12-31", windowDays: 366 });
    expect(service.dashboardInput({ periodType: "custom", startDate: "2024-09-03", endDate: "2026-09-03" })).toMatchObject({ windowDays: 731 });
    expect(() => service.dashboardInput({ periodType: "custom", startDate: "2024-09-03", endDate: "2026-09-04" })).toThrow(BadRequestException);
  });

  it("accepts multiple stable department IDs and rejects invalid department filters", () => {
    const service = new EquipmentQueryService({} as never) as any;
    const first = "00000000-0000-7000-8000-000000000011";
    const second = "00000000-0000-7000-8000-000000000012";
    expect(service.dashboardInput({ departmentId: [first, second, first] }).departmentIds).toEqual([first, second]);
    expect(() => service.dashboardInput({ departmentId: [first, "研发中心"] })).toThrow(BadRequestException);
  });

  it("parses the supported status-import duration formats", () => {
    const service = new EquipmentImportService({} as never) as any;
    expect(service.duration("12小时35分钟")).toBe(755);
    expect(service.duration("12:35")).toBe(755);
    expect(service.duration("755")).toBe(755);
    expect(service.duration(0)).toBe(0);
    expect(Number.isNaN(service.duration("十二小时"))).toBe(true);
  });
});
