import { tablePermissionFieldsFor } from "@kdos/contracts";
import { fieldsFor, MASTER_PLAN_RESOURCE_MAP, weeklyAdmissionMissingFields, weeklyAdmissionSql } from "./master-plan.config";

describe("master plan manual-entry configuration", () => {
  it.each([
    "mps-shipping-plans",
    "mps-base-plans",
    "mps-weekly-process-plans",
    "mps-customer-divisions",
    "mps-order-allocations",
    "mps-process-cycles"
  ])("enables manual creation for %s", (code) => {
    expect(MASTER_PLAN_RESOURCE_MAP.get(code as never)?.create).toBe(true);
  });

  it("only allows base-to-weekly to create division weekly plans", () => {
    expect(MASTER_PLAN_RESOURCE_MAP.get("mps-weekly-plans")?.create).toBe(false);
  });

  it("uses the approved full field names and new/old product meaning", () => {
    const fields = tablePermissionFieldsFor("mps-shipping-plans");
    expect(fields.find((field) => field.key === "itemCode")?.label).toBe("品项编码");
    expect(fields.find((field) => field.key === "itemName")?.label).toBe("品项名称");
    expect(fields.find((field) => field.key === "deliveryNumber")?.label).toBe("交期编码");
    expect(fields.find((field) => field.key === "modelAge")?.label).toBe("新旧款");
    expect(fields.filter((field) => ["itemName", "divisionId"].includes(field.key)).every((field) => field.required)).toBe(true);
    expect(fields.find((field) => field.key === "modelAge")?.required).toBe(false);
  });

  it("makes the requested base-plan fields required dictionaries with fixed options", () => {
    const fields = tablePermissionFieldsFor("mps-base-plans");
    const requiredKeys = ["latestReviewDueDate", "productAttribute", "surfaceNature", "manufacturingMethod"];
    expect(fields.filter((field) => requiredKeys.includes(field.key)).every((field) => field.required)).toBe(true);
    expect(fields.find((field) => field.key === "productAttribute")?.type).toBe("dictionary");
    expect(fields.find((field) => field.key === "surfaceNature")?.type).toBe("dictionary");
    expect(fieldsFor(MASTER_PLAN_RESOURCE_MAP.get("mps-base-plans")!).find((field) => field.key === "productAttribute")?.options?.map((option) => option.value)).toEqual(["五金", "木作", "亚克力", "五金+木作"]);
    expect(fieldsFor(MASTER_PLAN_RESOURCE_MAP.get("mps-base-plans")!).find((field) => field.key === "surfaceNature")?.options?.map((option) => option.value)).toEqual(["烤漆", "电镀"]);
    expect(fields.find((field) => field.key === "modelAge")?.required).toBe(false);
    expect(fieldsFor(MASTER_PLAN_RESOURCE_MAP.get("mps-base-plans")!).find((field) => field.key === "manufacturingMethod")?.options?.map((option) => option.value)).toEqual(["自制", "中心外购", "外协", "自制+外协"]);
  });

  it("separates weekly admission fields from ordinary update required fields", () => {
    const base = MASTER_PLAN_RESOURCE_MAP.get("mps-base-plans")!;
    expect(base.requiredAlways).toBeUndefined();
    expect(base.weeklyAdmissionRequiredFields).toEqual(["latestReviewDueDate", "productAttribute", "surfaceNature", "manufacturingMethod"]);
    expect(weeklyAdmissionMissingFields(base, { latestReviewDueDate: "2026-09-20", productAttribute: "五金" })).toEqual(["surfaceNature", "manufacturingMethod"]);
    expect(weeklyAdmissionSql(base)).toBe("latest_review_due_date IS NOT NULL AND product_attribute IS NOT NULL AND surface_nature IS NOT NULL AND manufacturing_method IS NOT NULL");
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

  it("uses 下单日期 everywhere in the master plan UI and hides customer name outside raw ERP", () => {
    for (const [code, resource] of MASTER_PLAN_RESOURCE_MAP) {
      const fields = tablePermissionFieldsFor(code);
      const orderDate = fields.find((field) => field.key === "orderDate"); if (orderDate) expect(orderDate.label).toBe("下单日期");
      expect(fields.map((field) => field.key)).not.toContain("customerName");
      expect(resource.code).toBe(code);
    }
  });
});
