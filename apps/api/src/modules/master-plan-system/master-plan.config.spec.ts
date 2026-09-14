import { tablePermissionFieldsFor } from "@kdos/contracts";
import { MASTER_PLAN_RESOURCE_MAP } from "./master-plan.config";

describe("master plan manual-entry configuration", () => {
  it.each([
    "mps-shipping-plans",
    "mps-base-plans",
    "mps-weekly-plans",
    "mps-weekly-process-plans",
    "mps-customer-divisions",
    "mps-order-allocations",
    "mps-process-cycles"
  ])("enables manual creation for %s", (code) => {
    expect(MASTER_PLAN_RESOURCE_MAP.get(code as never)?.create).toBe(true);
  });

  it("uses the approved full field names and new/old product meaning", () => {
    const fields = tablePermissionFieldsFor("mps-shipping-plans");
    expect(fields.find((field) => field.key === "itemCode")?.label).toBe("品项编码");
    expect(fields.find((field) => field.key === "itemName")?.label).toBe("品项名称");
    expect(fields.find((field) => field.key === "deliveryNumber")?.label).toBe("交期编码");
    expect(fields.find((field) => field.key === "modelAge")?.label).toBe("新旧款");
    expect(fields.filter((field) => ["itemName", "divisionId", "modelAge"].includes(field.key)).every((field) => field.required)).toBe(true);
  });

  it("makes the requested base-plan fields required dictionaries with fixed options", () => {
    const fields = tablePermissionFieldsFor("mps-base-plans");
    const requiredKeys = ["latestReviewDueDate", "productAttribute", "modelAge", "surfaceNature", "manufacturingMethod"];
    expect(fields.filter((field) => requiredKeys.includes(field.key)).every((field) => field.required)).toBe(true);
    expect(fields.find((field) => field.key === "productAttribute")?.type).toBe("dictionary");
    expect(fields.find((field) => field.key === "surfaceNature")?.type).toBe("dictionary");
    expect(MASTER_PLAN_RESOURCE_MAP.get("mps-base-plans")?.allowedValues).toMatchObject({
      productAttribute: ["五金", "木作", "亚克力", "五金+木作"], surfaceNature: ["烤漆", "电镀"]
    });
  });

  it("removes unapproved base/weekly fields and exposes daily reporting fields", () => {
    const baseKeys = tablePermissionFieldsFor("mps-base-plans").map((field) => field.key);
    const weeklyKeys = tablePermissionFieldsFor("mps-weekly-plans").map((field) => field.key);
    const processFields = tablePermissionFieldsFor("mps-weekly-process-plans");
    expect(baseKeys).not.toEqual(expect.arrayContaining(["admissionStatus", "admissionMessage"]));
    expect(weeklyKeys).not.toContain("plannedPageCount");
    expect(processFields.map((field) => field.key)).not.toContain("sequence");
    expect(processFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "weeklyPlanId", label: "所属事业部周计划" }),
      expect.objectContaining({ key: "reportDate", label: "报工日期", type: "date" }),
      expect.objectContaining({ key: "dailyReportedQuantity", label: "当日报工" })
    ]));
  });
});
