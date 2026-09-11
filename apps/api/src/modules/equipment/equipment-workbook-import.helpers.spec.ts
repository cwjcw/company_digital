import { departmentAliases, monitoringValue, plannedStartupMinutes, shouldSkipEquipmentImport } from "./equipment-workbook-import.helpers";

describe("equipment workbook import compatibility", () => {
  it("accepts business variants for equipment monitoring", () => {
    expect(monitoringValue("需要")).toBe(true);
    expect(monitoringValue("不需要")).toBe(false);
    expect(monitoringValue("")).toBe(false);
    expect(() => monitoringValue("以后再说")).toThrow("不是有效选项");
  });

  it("treats 不需要 as a valid instruction to skip the row", () => {
    expect(shouldSkipEquipmentImport("不需要")).toBe(true);
    expect(shouldSkipEquipmentImport(" 不需要 ")).toBe(true);
    expect(shouldSkipEquipmentImport("无需")).toBe(false);
    expect(shouldSkipEquipmentImport("需要")).toBe(false);
  });

  it("maps legacy division-four workshop names to stable organization nodes", () => {
    expect(departmentAliases["事业四部|五金车间"]).toBe("加工焊磨课");
    expect(departmentAliases["事业四部|包装车间"]).toBe("包装课");
  });

  it("parses the daily startup target from the current equipment-ledger template", () => {
    expect(plannedStartupMinutes("4小时")).toBe(240);
    expect(plannedStartupMinutes("11小时30分钟")).toBe(690);
    expect(plannedStartupMinutes("45分钟")).toBe(45);
    expect(plannedStartupMinutes(0)).toBe(0);
    expect(plannedStartupMinutes("")).toBe(0);
    expect(() => plannedStartupMinutes("全天")).toThrow("不是有效时长");
  });
});
